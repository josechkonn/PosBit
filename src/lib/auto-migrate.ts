import type { Pool, PoolClient } from "pg";
import fs from "fs";
import path from "path";

let migrationPromise: Promise<void> | null = null;

/**
 * Tablas cuyo `fecha` se escribía con la fecha en UTC (el bug que motivó
 * `fechaLocalISO` en `@/lib/format`). Lista FIJA a propósito: nunca se arma un
 * UPDATE sobre un nombre de tabla que venga de la base de datos.
 */
const TABLAS_CON_FECHA_DE_DOCUMENTO = ["ventas", "compras", "retornos", "compra_abonos", "abonos"];

/**
 * Corrige los documentos que quedaron con la fecha UN DÍA adelantado.
 *
 * El bug: `new Date().toISOString().split("T")[0]` devuelve la fecha en UTC, que
 * en Venezuela (UTC-4) ya es del día siguiente a partir de las 20:00. Una venta
 * de las 8:30 pm se guardaba con la fecha del 16 y no aparecía en el reporte del
 * 15. La fecha correcta es la del reloj del operador, que se reconstruye desde
 * `creado_en` (que sí lo guarda Postgres en hora local).
 *
 * POR QUÉ NO ROMPE NADA — el UPDATE solo toca filas que cumplen las TRES
 * condiciones de la firma exacta del bug:
 *   1. `fecha` = (fecha local de creación) + 1 día  → solo el desfase de un día
 *      hacia adelante. Un documento fechado a mano en el pasado (lo normal al
 *      registrar una venta de ayer) queda intacto: su `fecha` es ANTERIOR.
 *   2. Se creó de noche, en la franja en la que la fecha UTC se adelanta
 *      (hora local ≥ 24 − |offset del servidor|; en Caracas, desde las 20:00).
 *      El umbral se calcula desde la zona horaria del servidor, no fijo.
 *   3. Solo tablas que tengan `fecha` y `creado_en`.
 *
 * Es idempotente: una vez corregida, la fila ya no cumple la condición.
 */
async function corrigeFechasDesfasadasUTC(client: PoolClient | Pool): Promise<void> {
  try {
    const info = await client.query(
      `SELECT c.table_name,
              MAX(CASE WHEN c.column_name = 'fecha'     THEN 1 ELSE 0 END) AS tiene_fecha,
              MAX(CASE WHEN c.column_name = 'creado_en' THEN c.data_type END) AS creado_tipo
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.column_name IN ('fecha', 'creado_en')
          AND c.table_name = ANY($1::text[])
        GROUP BY c.table_name`,
      [TABLAS_CON_FECHA_DE_DOCUMENTO]
    );

    // Umbral horario del desfase, derivado del offset del servidor:
    // en UTC-4 el día local se adelanta a partir de las 20:00.
    const thr = await client.query(
      `SELECT 24 - abs(EXTRACT(timezone FROM now()) / 3600)::int AS hora`
    );
    const horaDesfase = Number(thr.rows[0]?.hora ?? 20);

    let total = 0;
    for (const row of info.rows) {
      if (!row.tiene_fecha || !row.creado_tipo) continue;

      // `creado_en` en timestamptz guarda un instante: hay que traerlo a la hora
      // local. En `timestamp` ya viene en hora local (NOW() la guarda en la zona
      // del servidor), así que se usa tal cual.
      const local =
        row.creado_tipo === "timestamp with time zone"
          ? `(creado_en AT TIME ZONE current_setting('TimeZone'))::timestamp`
          : `creado_en::timestamp`;

      const res = await client.query(
        `UPDATE "${row.table_name}"
            SET fecha = (${local})::date
          WHERE fecha = ((${local})::date + 1)
            AND EXTRACT(hour FROM (${local})::timestamp) >= $1`,
        [horaDesfase]
      );
      if (res.rowCount && res.rowCount > 0) {
        console.log(
          `🗓️  ${row.table_name}: ${res.rowCount} documento(s) con la fecha adelantada por UTC corregidos.`
        );
        total += res.rowCount;
      }
    }

    if (total > 0) {
      console.log(`🗓️  Fechas corregidas automáticamente: ${total} documento(s).`);
    }
  } catch (error) {
    // Nunca debe impedir que la app arranque: si esta corrección falla, se avisa
    // y se sigue. Los datos quedan como estaban (sin tocar).
    console.warn("Aviso: no se pudieron corregir las fechas con desfase UTC:", (error as Error)?.message || error);
  }
}

export async function ensureSchemaAndMigrate(customPool?: Pool | PoolClient): Promise<void> {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    let client: PoolClient | Pool = customPool as any;
    let releaseNeeded = false;

    if (!client) {
      const { pool } = await import("./db");
      client = await pool.connect();
      releaseNeeded = true;
    }

    try {
      // 1. Verificar si la BD ya tiene alguna tabla base (ej. 'ventas' o 'productos')
      const tableCheck = await client.query(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name IN ('ventas', 'productos')
      `);

      if (tableCheck.rows.length === 0) {
        // Base de datos nueva o vacía: schema.sql se encargará de crear todo;
        // limpiar migrationPromise para que la llamada post-schema ejecute la migración a UUID.
        migrationPromise = null;
        return;
      }

      // 2. Verificar tipo de ventas.id (si existe) para migración legacy integer → UUID
      const colCheck = await client.query(`
        SELECT udt_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'ventas' AND column_name = 'id'
      `);

      const currentType = colCheck.rows[0]?.udt_name;

      if (currentType === "int4") {
        console.log("🔄 Detectada BD con IDs integer → migrando a UUID...");

        const possiblePaths = [
          path.join(process.cwd(), "sql", "migrate-to-uuid.sql"),
          path.join(process.cwd(), "standalone", "sql", "migrate-to-uuid.sql"),
          path.join((process as unknown as { resourcesPath?: string }).resourcesPath || "", "standalone", "sql", "migrate-to-uuid.sql"),
        ];

        let sqlContent = "";
        for (const p of possiblePaths) {
          if (p && fs.existsSync(/*turbopackIgnore: true*/ p)) {
            sqlContent = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf-8");
            break;
          }
        }

        if (sqlContent) {
          await client.query(sqlContent);
          console.log("✅ Migración a UUID completada automáticamente.");
        } else {
          console.error("❌ No se encontró el script sql/migrate-to-uuid.sql");
        }
      }

      // 3. Verificación y migración incremental auto-adaptativa (IDEMPOTENTE Y SIN BORRADO DE DATOS)
      console.log("🔍 Verificando integridad de tablas y columnas (migración incremental)...");

      await client.query(`
        DO $$
        DECLARE
          v_monedas_id_type text;
          v_ventas_id_type text;
          v_clientes_id_type text;
          v_proveedores_id_type text;
          v_compras_id_type text;
        BEGIN
          -- Determinar tipos actuales de las PKs
          SELECT udt_name INTO v_monedas_id_type FROM information_schema.columns WHERE table_schema='public' AND table_name='monedas' AND column_name='id';
          SELECT udt_name INTO v_ventas_id_type FROM information_schema.columns WHERE table_schema='public' AND table_name='ventas' AND column_name='id';
          SELECT udt_name INTO v_clientes_id_type FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='id';
          SELECT udt_name INTO v_proveedores_id_type FROM information_schema.columns WHERE table_schema='public' AND table_name='proveedores' AND column_name='id';
          SELECT udt_name INTO v_compras_id_type FROM information_schema.columns WHERE table_schema='public' AND table_name='compras' AND column_name='id';

          -- ── A. CONFIGURACION GLOBAL ──────────────────────────────────────────
          CREATE TABLE IF NOT EXISTS configuracion_global (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            metodo_conversion_compras VARCHAR(20) NOT NULL DEFAULT 'directa',
            metodo_conversion_ventas VARCHAR(20) NOT NULL DEFAULT 'directa',
            auto_precio_compra BOOLEAN NOT NULL DEFAULT true,
            redondeo_activo BOOLEAN NOT NULL DEFAULT false,
            redondeo_multiplo DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
            redondeo_no_bajar_de_costo BOOLEAN NOT NULL DEFAULT true,
            actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE configuracion_global
            ALTER COLUMN metodo_conversion_compras TYPE VARCHAR(20),
            ALTER COLUMN metodo_conversion_ventas TYPE VARCHAR(20);

          IF v_monedas_id_type = 'uuid' THEN
            ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS moneda_transito_compras_id UUID REFERENCES monedas(id) ON DELETE SET NULL;
            ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS moneda_transito_ventas_id UUID REFERENCES monedas(id) ON DELETE SET NULL;
          ELSE
            ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS moneda_transito_compras_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL;
            ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS moneda_transito_ventas_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL;
          END IF;

          INSERT INTO configuracion_global (id, metodo_conversion_compras, metodo_conversion_ventas, auto_precio_compra, redondeo_activo, redondeo_multiplo, redondeo_no_bajar_de_costo)
          VALUES (1, 'directa', 'directa', true, false, 0.00, true)
          ON CONFLICT (id) DO NOTHING;

          -- ── B. VENTA COBROS EXTRA ────────────────────────────────────────────
          IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='venta_cobros_extra') THEN
            IF v_ventas_id_type = 'uuid' THEN
              CREATE TABLE venta_cobros_extra (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
                concepto VARCHAR(150) NOT NULL,
                monto DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
                monto_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
                creado_en TIMESTAMP NOT NULL DEFAULT NOW()
              );
            ELSE
              CREATE TABLE venta_cobros_extra (
                id SERIAL PRIMARY KEY,
                venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
                concepto VARCHAR(150) NOT NULL,
                monto DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
                monto_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
                creado_en TIMESTAMP NOT NULL DEFAULT NOW()
              );
            END IF;
          END IF;
          CREATE INDEX IF NOT EXISTS idx_venta_cobros_extra_venta ON venta_cobros_extra(venta_id);

          -- ── C. PRODUCTO PRESENTACIONES ───────────────────────────────────────
          CREATE TABLE IF NOT EXISTS producto_presentaciones (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
            nombre VARCHAR(100) NOT NULL,
            unidades INTEGER NOT NULL CHECK (unidades > 1),
            activo BOOLEAN NOT NULL DEFAULT true,
            modo_venta VARCHAR(10) NOT NULL DEFAULT 'derivado',
            precio_override NUMERIC(18, 6) NULL,
            margen_override NUMERIC(6, 3) NULL,
            codigo VARCHAR(50) NULL,
            creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
            actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (producto_id, nombre)
          );
          ALTER TABLE producto_presentaciones ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
          ALTER TABLE producto_presentaciones ADD COLUMN IF NOT EXISTS modo_venta VARCHAR(10) NOT NULL DEFAULT 'derivado';
          ALTER TABLE producto_presentaciones ADD COLUMN IF NOT EXISTS precio_override NUMERIC(18, 6) NULL;
          ALTER TABLE producto_presentaciones ADD COLUMN IF NOT EXISTS margen_override NUMERIC(6, 3) NULL;
          ALTER TABLE producto_presentaciones ADD COLUMN IF NOT EXISTS codigo VARCHAR(50) NULL;
          UPDATE producto_presentaciones SET modo_venta = 'derivado' WHERE modo_venta IS NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_presentaciones_codigo
            ON producto_presentaciones (lower(codigo)) WHERE codigo IS NOT NULL;

          -- ── D. PRODUCTO PROVEEDORES ──────────────────────────────────────────
          IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='producto_proveedores') THEN
            IF v_proveedores_id_type = 'uuid' THEN
              CREATE TABLE producto_proveedores (
                producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
                proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
                PRIMARY KEY (producto_id, proveedor_id)
              );
            ELSE
              CREATE TABLE producto_proveedores (
                producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
                proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
                PRIMARY KEY (producto_id, proveedor_id)
              );
            END IF;
          ELSE
            -- Si la tabla ya existía pero le falta la clave primaria o índice único
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'producto_proveedores'::regclass
                  AND contype IN ('p', 'u')
              ) THEN
                DELETE FROM producto_proveedores a
                USING producto_proveedores b
                WHERE a.ctid < b.ctid
                  AND a.producto_id = b.producto_id
                  AND a.proveedor_id = b.proveedor_id;

                ALTER TABLE producto_proveedores ADD PRIMARY KEY (producto_id, proveedor_id);
              END IF;
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END;
          END IF;
          INSERT INTO producto_proveedores (producto_id, proveedor_id)
          SELECT id, proveedor_id FROM productos WHERE proveedor_id IS NOT NULL
          ON CONFLICT DO NOTHING;
          CREATE INDEX IF NOT EXISTS idx_producto_proveedores_proveedor ON producto_proveedores(proveedor_id);

          -- ── E. COLUMNAS PRODUCTOS ───────────────────────────────────────────
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_promedio DECIMAL(18, 6) NOT NULL DEFAULT 0.000000;
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_promedio_base DECIMAL(18, 6) NOT NULL DEFAULT 0.000000;
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS margen_ganancia DECIMAL(5, 2) NOT NULL DEFAULT 0.00;
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_auto BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_actualizado_en TIMESTAMP;
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS iva_incluido BOOLEAN NOT NULL DEFAULT true;
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE productos ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMP;
          CREATE INDEX IF NOT EXISTS idx_productos_eliminado ON productos(eliminado);
          IF v_monedas_id_type = 'uuid' THEN
            ALTER TABLE productos ADD COLUMN IF NOT EXISTS moneda_costo_id UUID REFERENCES monedas(id) ON DELETE SET NULL;
          ELSE
            ALTER TABLE productos ADD COLUMN IF NOT EXISTS moneda_costo_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL;
          END IF;
          -- Backfill inicial seguro del CPP
          UPDATE productos SET costo_promedio = costo_base WHERE (costo_promedio IS NULL OR costo_promedio = 0) AND costo_base > 0;

          -- ── F. COLUMNAS VENTAS Y VENTA_ITEMS ─────────────────────────────────
          ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cobros_extra DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
          ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cobros_extra_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
          ALTER TABLE ventas ADD COLUMN IF NOT EXISTS descuento DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
          ALTER TABLE ventas ADD COLUMN IF NOT EXISTS descuento_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
          ALTER TABLE ventas ADD COLUMN IF NOT EXISTS tasa DECIMAL(18, 6);
          ALTER TABLE ventas ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP NOT NULL DEFAULT NOW();
          IF v_clientes_id_type = 'uuid' THEN
            ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;
          ELSE
            ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
          END IF;

          ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS presentacion_id UUID NULL REFERENCES producto_presentaciones(id) ON DELETE SET NULL;
          ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS presentacion_nombre VARCHAR NULL;
          ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS presentacion_unidades INTEGER NULL;
          ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS cantidad_presentaciones DECIMAL(18, 6) NULL;
          ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS precio_presentacion DECIMAL(18, 6) NULL;
          ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS descuento DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
          ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS descuento_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
          CREATE INDEX IF NOT EXISTS idx_venta_items_presentacion ON venta_items(presentacion_id);

          -- ── G. COLUMNAS COMPRAS Y COMPRA_ITEMS ───────────────────────────────
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_pago_compra') THEN
            CREATE TYPE estado_pago_compra AS ENUM ('pagado', 'parcial', 'pendiente');
          END IF;
          ALTER TABLE compras ADD COLUMN IF NOT EXISTS estado_pago estado_pago_compra NOT NULL DEFAULT 'pagado';
          ALTER TABLE compras ADD COLUMN IF NOT EXISTS saldo_pendiente NUMERIC(18, 6) NOT NULL DEFAULT 0;
          ALTER TABLE compras ADD COLUMN IF NOT EXISTS descuento_pct NUMERIC(6, 3) NOT NULL DEFAULT 0;
          ALTER TABLE compras ADD COLUMN IF NOT EXISTS descuento_monto NUMERIC(18, 6) NOT NULL DEFAULT 0;
          ALTER TABLE compras ADD COLUMN IF NOT EXISTS referencia VARCHAR(100);
          ALTER TABLE compras ADD COLUMN IF NOT EXISTS tasa DECIMAL(18, 6);

          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS descuento1_pct NUMERIC(6, 3) NOT NULL DEFAULT 0;
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS descuento2_pct NUMERIC(6, 3) NOT NULL DEFAULT 0;
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS subtotal_bruto NUMERIC(18, 6) NOT NULL DEFAULT 0;
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS descuento_monto NUMERIC(18, 6) NOT NULL DEFAULT 0;
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS presentacion_id UUID REFERENCES producto_presentaciones(id) ON DELETE SET NULL;
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS presentacion_nombre VARCHAR(100);
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS presentacion_unidades INTEGER;
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS cantidad_presentaciones INTEGER;
          ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS costo_presentacion DECIMAL(18, 2);
          UPDATE compra_items SET subtotal_bruto = subtotal WHERE (subtotal_bruto IS NULL OR subtotal_bruto = 0) AND subtotal > 0;

          -- ── H. TABLA COMPRA_ABONOS ───────────────────────────────────────────
          IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='compra_abonos') THEN
            IF v_compras_id_type = 'uuid' THEN
              CREATE TABLE compra_abonos (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                compra_id UUID NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,
                fecha DATE NOT NULL DEFAULT CURRENT_DATE,
                monto NUMERIC(18, 6) NOT NULL,
                moneda_id UUID NOT NULL REFERENCES monedas(id),
                tasa_cambio NUMERIC(18, 6) NOT NULL,
                monto_base NUMERIC(18, 6) NOT NULL,
                metodo_pago_id UUID REFERENCES metodos_pago(id),
                caja_id UUID REFERENCES cajas(id),
                observaciones TEXT,
                creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
              );
            ELSE
              CREATE TABLE compra_abonos (
                id SERIAL PRIMARY KEY,
                compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,
                fecha DATE NOT NULL DEFAULT CURRENT_DATE,
                monto NUMERIC(18, 6) NOT NULL,
                moneda_id INTEGER NOT NULL REFERENCES monedas(id),
                tasa_cambio NUMERIC(18, 6) NOT NULL,
                monto_base NUMERIC(18, 6) NOT NULL,
                metodo_pago_id INTEGER REFERENCES metodos_pago(id),
                caja_id INTEGER REFERENCES cajas(id),
                observaciones TEXT,
                creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
              );
            END IF;
          END IF;
          CREATE INDEX IF NOT EXISTS idx_compra_abonos_compra ON compra_abonos(compra_id);
          CREATE INDEX IF NOT EXISTS idx_compra_abonos_fecha ON compra_abonos(fecha);

          -- ── I. TABLA PRODUCTO_COSTOS_HISTORICOS ──────────────────────────────
          IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='producto_costos_historicos') THEN
            CREATE TABLE producto_costos_historicos (
              id SERIAL PRIMARY KEY,
              producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
              cantidad INTEGER NOT NULL,
              presentacion_id UUID REFERENCES producto_presentaciones(id) ON DELETE SET NULL,
              presentacion_nombre VARCHAR(100),
              presentacion_unidades INTEGER,
              cantidad_presentaciones INTEGER,
              costo_presentacion DECIMAL(18, 2),
              costo_unit DECIMAL(18, 6),
              costo_unit_base DECIMAL(18, 6),
              fecha DATE NOT NULL DEFAULT CURRENT_DATE,
              creado_en TIMESTAMP NOT NULL DEFAULT NOW()
            );
            IF v_monedas_id_type = 'uuid' THEN
              ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS moneda_id UUID REFERENCES monedas(id) ON DELETE RESTRICT;
            ELSE
              ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS moneda_id INTEGER REFERENCES monedas(id) ON DELETE RESTRICT;
            END IF;
            IF v_compras_id_type = 'uuid' THEN
              ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES compras(id) ON DELETE CASCADE;
            ELSE
              ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE;
            END IF;
          END IF;
          CREATE INDEX IF NOT EXISTS idx_producto_costos_historicos_producto ON producto_costos_historicos(producto_id, fecha DESC, creado_en DESC);
          CREATE INDEX IF NOT EXISTS idx_producto_costos_historicos_compra ON producto_costos_historicos(compra_id);

          -- ── J. MONEDAS Y CONFIGURACION ───────────────────────────────────────
          ALTER TABLE monedas ADD COLUMN IF NOT EXISTS decimales INT NOT NULL DEFAULT 2;
          ALTER TABLE monedas ADD COLUMN IF NOT EXISTS usa_tasa_usd_directa BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE monedas ADD COLUMN IF NOT EXISTS tasa_usd_directa DECIMAL(18, 6);
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monedas' AND column_name='tasa_ref_moneda_id') THEN
            IF v_monedas_id_type = 'uuid' THEN
              ALTER TABLE monedas ADD COLUMN tasa_ref_moneda_id UUID REFERENCES monedas(id) ON DELETE SET NULL;
            ELSE
              ALTER TABLE monedas ADD COLUMN tasa_ref_moneda_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL;
            END IF;
          END IF;

          UPDATE configuracion SET valor = 'Promedio' WHERE clave = 'inventario_metodo_costeo' AND valor = 'FIFO';
        END $$;
      `);

      // ── Sincronizar todas las secuencias seriales de PostgreSQL ───────────
      try {
        await client.query(`
          DO $$
          DECLARE
            rec record;
            max_id bigint;
          BEGIN
            FOR rec IN
              SELECT c.table_name,
                     c.column_name,
                     pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) AS seq_name
              FROM information_schema.columns c
              WHERE c.table_schema = 'public'
                AND c.column_name = 'id'
                AND c.data_type IN ('integer', 'bigint', 'smallint')
                AND pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) IS NOT NULL
            LOOP
              EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', rec.column_name, rec.table_name) INTO max_id;
              IF max_id > 0 THEN
                PERFORM setval(rec.seq_name, max_id, true);
              ELSE
                PERFORM setval(rec.seq_name, 1, false);
              END IF;
            END LOOP;
          END $$;
        `);
      } catch (seqErr) {
        console.warn("Aviso al sincronizar secuencias:", (seqErr as Error)?.message || seqErr);
      }

      // ── Corrección de fechas adelantadas por desfase UTC ──────────────────
      await corrigeFechasDesfasadasUTC(client);

      console.log("✅ Migraciones automáticas verificadas y aplicadas con éxito sin alteración de datos existentes.");
    } catch (error) {
      console.error("❌ Error en migración automática:", error);
    } finally {
      if (releaseNeeded && "release" in client && typeof client.release === "function") {
        (client as PoolClient).release();
      }
    }
  })();

  return migrationPromise;
}