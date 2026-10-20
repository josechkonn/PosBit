-- ============================================================================
-- POSBIT - Infraestructura de Sincronización Offline-First / Nube (Local ↔ Cloud)
-- ============================================================================
-- Este script es 100% idempotente y prepara la base de datos para:
--   1. Rastreo incremental de cambios (actualizado_en en todas las tablas sincronizables)
--   2. Registro de eliminaciones (Tombstones en sync_eliminados) para propagar borrados
--   3. Configuración local del nodo/dispositivo (sync_config)
--   4. Historial de sincronizaciones (sync_historial)
-- ============================================================================

-- 1. Asegurar función de actualización de timestamp
CREATE OR REPLACE FUNCTION actualizar_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Asegurar columna actualizado_en en todas las tablas sincronizables que no la tenían
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE producto_presentaciones ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE producto_precios ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE producto_proveedores ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE venta_pagos ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE venta_cobros_extra ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE retorno_items ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE abonos ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE kardex ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT NOW();

-- 3. Asegurar triggers BEFORE UPDATE en las tablas sincronizables
DROP TRIGGER IF EXISTS trg_configuracion_actualizado ON configuracion;
CREATE TRIGGER trg_configuracion_actualizado BEFORE UPDATE ON configuracion
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_configuracion_global_actualizado ON configuracion_global;
CREATE TRIGGER trg_configuracion_global_actualizado BEFORE UPDATE ON configuracion_global
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_producto_presentaciones_actualizado ON producto_presentaciones;
CREATE TRIGGER trg_producto_presentaciones_actualizado BEFORE UPDATE ON producto_presentaciones
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_producto_precios_actualizado ON producto_precios;
CREATE TRIGGER trg_producto_precios_actualizado BEFORE UPDATE ON producto_precios
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_producto_proveedores_actualizado ON producto_proveedores;
CREATE TRIGGER trg_producto_proveedores_actualizado BEFORE UPDATE ON producto_proveedores
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_producto_costos_historicos_actualizado ON producto_costos_historicos;
CREATE TRIGGER trg_producto_costos_historicos_actualizado BEFORE UPDATE ON producto_costos_historicos
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_compra_items_actualizado ON compra_items;
CREATE TRIGGER trg_compra_items_actualizado BEFORE UPDATE ON compra_items
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_venta_items_actualizado ON venta_items;
CREATE TRIGGER trg_venta_items_actualizado BEFORE UPDATE ON venta_items
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_venta_pagos_actualizado ON venta_pagos;
CREATE TRIGGER trg_venta_pagos_actualizado BEFORE UPDATE ON venta_pagos
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_venta_cobros_extra_actualizado ON venta_cobros_extra;
CREATE TRIGGER trg_venta_cobros_extra_actualizado BEFORE UPDATE ON venta_cobros_extra
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_retorno_items_actualizado ON retorno_items;
CREATE TRIGGER trg_retorno_items_actualizado BEFORE UPDATE ON retorno_items
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_abonos_actualizado ON abonos;
CREATE TRIGGER trg_abonos_actualizado BEFORE UPDATE ON abonos
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_kardex_actualizado ON kardex;
CREATE TRIGGER trg_kardex_actualizado BEFORE UPDATE ON kardex
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_transacciones_actualizado ON transacciones;
CREATE TRIGGER trg_transacciones_actualizado BEFORE UPDATE ON transacciones
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_cierres_caja_actualizado ON cierres_caja;
CREATE TRIGGER trg_cierres_caja_actualizado BEFORE UPDATE ON cierres_caja
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_cliente_limites_credito_actualizado ON cliente_limites_credito;
CREATE TRIGGER trg_cliente_limites_credito_actualizado BEFORE UPDATE ON cliente_limites_credito
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

DROP TRIGGER IF EXISTS trg_compra_abonos_actualizado ON compra_abonos;
CREATE TRIGGER trg_compra_abonos_actualizado BEFORE UPDATE ON compra_abonos
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

-- 4. Índices de alto rendimiento para consultas delta y dashboard
CREATE INDEX IF NOT EXISTS idx_monedas_actualizado_en ON monedas(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_cajas_actualizado_en ON cajas(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_metodos_pago_actualizado_en ON metodos_pago(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_categorias_actualizado_en ON categorias(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_marcas_actualizado_en ON marcas(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_proveedores_actualizado_en ON proveedores(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_productos_actualizado_en ON productos(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_producto_precios_actualizado_en ON producto_precios(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_ventas_actualizado_en ON ventas(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_venta_items_actualizado_en ON venta_items(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_compras_actualizado_en ON compras(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_compra_items_actualizado_en ON compra_items(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_clientes_actualizado_en ON clientes(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_creditos_actualizado_en ON creditos(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_abonos_actualizado_en ON abonos(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_retornos_actualizado_en ON retornos(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_kardex_actualizado_en ON kardex(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_transacciones_actualizado_en ON transacciones(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_ventas_estado_moneda_fecha ON ventas(estado, moneda_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_compras_estado_moneda_fecha ON compras(estado, moneda_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_productos_activo_stock ON productos(activo, stock, stock_minimo);

-- 5. Tabla de configuración de sincronización del dispositivo (fila única id = 1)
CREATE TABLE IF NOT EXISTS sync_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    dispositivo_id UUID NOT NULL DEFAULT gen_random_uuid(),
    nombre_dispositivo VARCHAR(100) NOT NULL DEFAULT 'Caja Principal',
    -- 'desactivado' | 'api_nube' (URL de servidor PosBit Cloud) | 'db_directa' (PostgreSQL Cloud directo)
    modo_conexion VARCHAR(20) NOT NULL DEFAULT 'desactivado'
        CHECK (modo_conexion IN ('desactivado', 'api_nube', 'db_directa')),
    cloud_url TEXT,
    cloud_api_key TEXT,
    cloud_database_url TEXT,
    auto_sync BOOLEAN NOT NULL DEFAULT true,
    intervalo_segundos INTEGER NOT NULL DEFAULT 30 CHECK (intervalo_segundos >= 5),
    ultima_sincronizacion_push TIMESTAMPTZ,
    ultima_sincronizacion_pull TIMESTAMPTZ,
    ultimo_estado VARCHAR(30) NOT NULL DEFAULT 'sin_configurar',
    ultimo_error TEXT,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sync_config (id, nombre_dispositivo, modo_conexion, auto_sync, intervalo_segundos, ultimo_estado)
VALUES (1, 'Caja Principal', 'desactivado', true, 30, 'sin_configurar')
ON CONFLICT (id) DO NOTHING;

-- 6. Tabla de Tombstones (registro de filas eliminadas para propagar DELETEs entre equipos y nube)
CREATE TABLE IF NOT EXISTS sync_eliminados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tabla VARCHAR(100) NOT NULL,
    registro_id TEXT NOT NULL,
    eliminado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tabla, registro_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_eliminados_fecha ON sync_eliminados(eliminado_en);

CREATE OR REPLACE FUNCTION registrar_eliminacion_sync()
RETURNS TRIGGER AS $$
BEGIN
    -- Si la eliminación viene de una restauración o sync interno que desactivó el flag, omitir
    IF current_setting('posbit.skip_tombstone', true) = 'true' THEN
        RETURN OLD;
    END IF;

    INSERT INTO sync_eliminados (tabla, registro_id, eliminado_en)
    VALUES (TG_TABLE_NAME, OLD.id::text, NOW())
    ON CONFLICT (tabla, registro_id)
    DO UPDATE SET eliminado_en = NOW();

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Adjuntar triggers de tombstone a tablas con clave primaria id
DO $$
DECLARE
    t text;
    tablas_con_id text[] := ARRAY[
        'categorias', 'marcas', 'proveedores', 'clientes', 'cliente_limites_credito',
        'productos', 'producto_presentaciones', 'producto_precios', 'cajas',
        'metodos_pago', 'compras', 'compra_items', 'compra_abonos',
        'ventas', 'venta_items', 'venta_pagos', 'venta_cobros_extra',
        'creditos', 'abonos', 'retornos', 'retorno_items'
    ];
BEGIN
    FOREACH t IN ARRAY tablas_con_id LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_sync_delete ON %I', t, t);
            EXECUTE format(
                'CREATE TRIGGER trg_%I_sync_delete AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION registrar_eliminacion_sync()',
                t, t
            );
        END IF;
    END LOOP;
END $$;

-- 7. Historial de ejecuciones de sincronización
CREATE TABLE IF NOT EXISTS sync_historial (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    direccion VARCHAR(20) NOT NULL, -- 'bidireccional' | 'push' | 'pull' | 'entrante'
    registros_subidos INTEGER NOT NULL DEFAULT 0,
    registros_bajados INTEGER NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL, -- 'ok' | 'error'
    detalle TEXT,
    duracion_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sync_historial_fecha ON sync_historial(fecha DESC);
