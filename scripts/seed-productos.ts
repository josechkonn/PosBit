// ============================================================================
// POSBIT - Seed de productos de prueba
// ----------------------------------------------------------------------------
// Crea (de forma idempotente) 100 productos de prueba CON stock, sus precios
// por moneda derivados de `precio_base`/`costo_base` y su movimiento inicial
// en el kardex ("Existencias iniciales"), replicando lo que hace el endpoint
// POST /api/productos.
//
// Uso:
//   npx tsx scripts/seed-productos.ts            # crea los 100 productos
//   npx tsx scripts/seed-productos.ts 50         # crea 50 productos
//   npx tsx scripts/seed-productos.ts --clean    # elimina SOLO los productos TEST-*
//
// Los productos usan el prefijo de código TEST- para poder identificarlos y
// limpiarlos sin tocar datos reales.
// ============================================================================

import { Pool } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";
import { convertir, tasaUsd, aBase } from "../src/lib/money.ts";

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------
function resolverDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = resolve(process.cwd(), ".env.local");
  const env = readFileSync(envPath, "utf-8");
  const linea = env
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!linea) throw new Error(`DATABASE_URL no encontrada en ${envPath}`);

  return linea.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

// ---------------------------------------------------------------------------
// PRNG determinista (mulberry32): mismos datos en cada ejecución
// ---------------------------------------------------------------------------
function crearRandom(semilla: number) {
  let a = semilla >>> 0;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = crearRandom(20261008);
const entre = (min: number, max: number) => Math.round(min + random() * (max - min));
const elegir = <T>(arr: T[]): T => arr[Math.floor(random() * arr.length)];

// ---------------------------------------------------------------------------
// Catálogos de ejemplo (bodega)
// ---------------------------------------------------------------------------
const CATEGORIAS = [
  "Alimentos",
  "Bebidas",
  "Limpieza",
  "Cuidado Personal",
  "Snacks",
  "Lácteos",
  "Enlatados",
  "Panadería",
];

const MARCAS = [
  { nombre: "María", pais: "Venezuela" },
  { nombre: "Primor", pais: "Venezuela" },
  { nombre: "Mavesa", pais: "Venezuela" },
  { nombre: "Polar", pais: "Venezuela" },
  { nombre: "Coca-Cola", pais: "Estados Unidos" },
  { nombre: "Pepsi", pais: "Estados Unidos" },
  { nombre: "Nestlé", pais: "Suiza" },
  { nombre: "Colgate", pais: "Estados Unidos" },
  { nombre: "Ariel", pais: "Estados Unidos" },
  { nombre: "Kraft", pais: "Estados Unidos" },
];

const PROVEEDORES = [
  { nombre: "Distribuidora El Progreso", contacto: "María Pérez", email: "ventas@elprogreso.com", telefono: "0414-1234567", ciudad: "Caracas", rif: "J-12345678-9" },
  { nombre: "Alimentos del Centro", contacto: "José Rodríguez", email: "pedidos@alicentro.com", telefono: "0424-7654321", ciudad: "Valencia", rif: "J-23456789-0" },
  { nombre: "Comercial La Bodega", contacto: "Ana Gómez", email: "compras@labodega.com", telefono: "0412-9876543", ciudad: "Maracay", rif: "J-34567890-1" },
  { nombre: "Importadora Global Foods", contacto: "Luis Martínez", email: "info@globalfoods.com", telefono: "0212-5551234", ciudad: "Barquisimeto", rif: "J-45678901-2" },
  { nombre: "Suministros del Este", contacto: "Carla Díaz", email: "ventas@sumiex.com", telefono: "0416-3344556", ciudad: "Puerto La Cruz", rif: "J-56789012-3" },
];

// 20 bases x 5 presentaciones = 100 nombres únicos
const BASES = [
  { nombre: "Arroz Blanco", categoria: "Alimentos" },
  { nombre: "Harina de Maíz", categoria: "Alimentos" },
  { nombre: "Aceite de Girasol", categoria: "Alimentos" },
  { nombre: "Azúcar Refinada", categoria: "Alimentos" },
  { nombre: "Café Molido", categoria: "Alimentos" },
  { nombre: "Pasta Corta", categoria: "Alimentos" },
  { nombre: "Atún en Aceite", categoria: "Enlatados" },
  { nombre: "Sardinas en Tomate", categoria: "Enlatados" },
  { nombre: "Leche en Polvo", categoria: "Lácteos" },
  { nombre: "Queso Blanco", categoria: "Lácteos" },
  { nombre: "Galletas de Soda", categoria: "Snacks" },
  { nombre: "Papas Fritas", categoria: "Snacks" },
  { nombre: "Jabón en Barra", categoria: "Limpieza" },
  { nombre: "Detergente en Polvo", categoria: "Limpieza" },
  { nombre: "Cloro", categoria: "Limpieza" },
  { nombre: "Papel Higiénico", categoria: "Cuidado Personal" },
  { nombre: "Crema Dental", categoria: "Cuidado Personal" },
  { nombre: "Shampoo", categoria: "Cuidado Personal" },
  { nombre: "Refresco de Cola", categoria: "Bebidas" },
  { nombre: "Agua Mineral", categoria: "Bebidas" },
];

const PRESENTACIONES = ["250 g", "500 g", "1 kg", "1 L", "Pack x 3"];

// ---------------------------------------------------------------------------
// Operaciones de catálogo
// ---------------------------------------------------------------------------
async function asegurarCatalogo(pool: Pool) {
  const categoriaIds = new Map<string, number>();
  for (const nombre of CATEGORIAS) {
    const r = await pool.query(
      `INSERT INTO categorias (nombre, descripcion, activo)
       VALUES ($1, $2, true)
       ON CONFLICT (nombre) DO UPDATE SET activo = true
       RETURNING id`,
      [nombre, `Categoría de prueba: ${nombre}`]
    );
    categoriaIds.set(nombre, r.rows[0].id);
  }

  const marcaIds = new Map<string, number>();
  for (const m of MARCAS) {
    const r = await pool.query(
      `INSERT INTO marcas (nombre, pais, activo)
       VALUES ($1, $2, true)
       ON CONFLICT (nombre) DO UPDATE SET activo = true
       RETURNING id`,
      [m.nombre, m.pais]
    );
    marcaIds.set(m.nombre, r.rows[0].id);
  }

  const proveedorIds: number[] = [];
  for (const p of PROVEEDORES) {
    const existente = await pool.query(
      `SELECT id FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))`,
      [p.nombre]
    );
    if (existente.rows.length > 0) {
      proveedorIds.push(existente.rows[0].id);
      continue;
    }
    const r = await pool.query(
      `INSERT INTO proveedores (nombre, contacto, email, telefono, ciudad, rif, activo)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      [p.nombre, p.contacto, p.email, p.telefono, p.ciudad, p.rif]
    );
    proveedorIds.push(r.rows[0].id);
  }

  return { categoriaIds, marcaIds, proveedorIds };
}

// ---------------------------------------------------------------------------
// Seed principal
// ---------------------------------------------------------------------------
async function crearProductos(pool: Pool, cantidad: number) {
  const { categoriaIds, marcaIds, proveedorIds } = await asegurarCatalogo(pool);
  const marcaNombres = MARCAS.map((m) => m.nombre);

  // Catálogo completo de monedas (como en el endpoint POST /api/productos)
  const monedas = (await pool.query(`SELECT * FROM monedas`)).rows;
  const monedaBase = monedas.find((m: any) => m.es_base) || monedas[0];

  let creados = 0;
  let existentes = 0;

  // Todas las bases x presentaciones, recortado a `cantidad`
  const combos: { nombre: string; categoria: string; presentacion: string }[] = [];
  for (const base of BASES) {
    for (const presentacion of PRESENTACIONES) {
      combos.push({ ...base, presentacion });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (let i = 0; i < cantidad && i < combos.length; i++) {
      const combo = combos[i];
      const codigo = `TEST-${String(i + 1).padStart(3, "0")}`;
      const nombre = `${combo.nombre} ${combo.presentacion}`;
      const categoriaId = categoriaIds.get(combo.categoria) ?? null;
      const marcaId = marcaIds.get(elegir(marcaNombres)) ?? null;
      const proveedorId = elegir(proveedorIds) ?? null;

      const costoBase = Number((0.5 + random() * 29.5).toFixed(2));
      const margen = 1.3 + random() * 0.6; // 30 % - 90 %
      const precioBase = Number((costoBase * margen).toFixed(2));
      const stock = entre(10, 250);
      const stockMinimo = entre(5, 25);

      const res = await client.query(
        `INSERT INTO productos
           (codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id,
            stock, stock_minimo, precio_base, costo_base, activo, iva_incluido, moneda_base_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,$11)
         ON CONFLICT (codigo) DO NOTHING
         RETURNING id`,
        [
          codigo,
          nombre,
          `Producto de prueba (${combo.categoria})`,
          categoriaId,
          marcaId,
          proveedorId,
          stock,
          stockMinimo,
          precioBase,
          costoBase,
          monedaBase.id,
        ]
      );

      if (res.rows.length === 0) {
        existentes++;
        continue;
      }

      const productoId = res.rows[0].id;

      // Precios por moneda derivados de la moneda del producto
      for (const moneda of monedas) {
        const decimales = Number(moneda.decimales ?? 2);
        const precio = convertir(precioBase, monedaBase, moneda, monedas, decimales);
        const costo = convertir(costoBase, monedaBase, moneda, monedas, decimales);
        await client.query(
          `INSERT INTO producto_precios (producto_id, moneda_id, precio, costo)
           VALUES ($1, $2, $3, $4)`,
          [productoId, moneda.id, precio, costo]
        );
      }

      // Movimiento inicial en el kardex (entrada de existencias)
      const costoUsd = aBase(costoBase, tasaUsd(monedaBase, monedas));
      await client.query(
        `INSERT INTO kardex
           (producto_id, fecha, tipo, motivo, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual)
         VALUES ($1, NOW(), 'Entrada', 'Existencias iniciales', $2, $3, $4, 0, $2)`,
        [productoId, stock, costoBase, costoUsd]
      );

      creados++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { creados, existentes, monedas };
}

// ---------------------------------------------------------------------------
// Limpieza de productos de prueba
// ---------------------------------------------------------------------------
async function limpiarProductos(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ids = (
      await client.query(`SELECT id FROM productos WHERE codigo LIKE 'TEST-%'`)
    ).rows.map((r: any) => r.id);

    if (ids.length > 0) {
      // kardex y compra/venta items referencian productos con RESTRICT
      await client.query(`DELETE FROM kardex WHERE producto_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM producto_precios WHERE producto_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM productos WHERE id = ANY($1::int[])`, [ids]);
    }

    await client.query("COMMIT");
    return ids.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const limpiar = args.includes("--clean");
  const cantidadArg = args.find((a) => /^\d+$/.test(a));
  const cantidad = cantidadArg ? Math.max(1, parseInt(cantidadArg, 10)) : 100;

  const pool = new Pool({ connectionString: resolverDatabaseUrl(), max: 5 });

  try {
    if (limpiar) {
      const eliminados = await limpiarProductos(pool);
      console.log(`🧹 Productos de prueba eliminados: ${eliminados}`);
      return;
    }

    const { creados, existentes, monedas } = await crearProductos(pool, cantidad);
    const total = (
      await pool.query(`SELECT COUNT(*) n FROM productos WHERE codigo LIKE 'TEST-%'`)
    ).rows[0].n;

    console.log("");
    console.log("✅ Seed de productos de prueba completado");
    console.log(`   Productos nuevos:    ${creados}`);
    console.log(`   Ya existentes:       ${existentes}`);
    console.log(`   Total TEST-*:        ${total}`);
    console.log(`   Monedas con precio:  ${monedas.map((m: any) => m.codigo).join(", ")}`);
    console.log("");
    console.log("   Para eliminarlos: npx tsx scripts/seed-productos.ts --clean");
  } catch (err) {
    console.error("❌ Error en el seed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
