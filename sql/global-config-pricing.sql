-- ============================================================================
-- POSBIT - Configuración Global centralizada + CPP + Efecto Cascada de precios
-- ----------------------------------------------------------------------------
-- Migración IDEMPOTENTE (se ejecuta en cada arranque junto con schema.sql).
-- Añade:
--   1. `configuracion_global`       → reglas del "motor" (fila única, tipada).
--   2. Columnas de costeo/margen    → productos (margen_ganancia, CPP).
--   3. `producto_costos_historicos` → histórico de costos para autocompletar.
--
-- Decisiones de diseño:
--   * La "Unidad" es la base interna (ya implementada en producto_presentaciones:
--     el factor `unidades` SIEMPRE se traduce a unidades). No se toca.
--   * La moneda ancla interna del CPP es la moneda base del sistema (es_base);
--     se guarda además el CPP en la moneda de COMPRA del producto.
--   * `configuracion` (K:V) se conserva para datos de empresa/IVA/stock.
--     `configuracion_global` es la tabla tipada de reglas operativas.
-- ============================================================================

-- ============================================================================
-- 1. CONFIGURACION_GLOBAL  (fila única, id = 1)
-- ============================================================================
-- `metodo_conversion_{compras,ventas}`: cómo se convierten importes entre la
--   moneda del documento y la moneda de costo/venta del producto.
--     'directa'      → par directo según la regla de src/lib/money.ts.
--     'triangulacion'→ obliga a pasar por la moneda de tránsito configurada
--                      (ej. USD → VES → COP), ignorando el par directo.
-- `auto_precio_compra`: toggle maestro del recálculo automático del precio de
--   venta justo después de registrar una compra (efecto cascada).
-- `redondeo_*`: regla GLOBAL de redondeo (activo + múltiplo + suelo de costo).
-- ============================================================================
CREATE TABLE IF NOT EXISTS configuracion_global (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- fila única: solo existe la 1
    metodo_conversion_compras VARCHAR(20) NOT NULL DEFAULT 'directa'
        CHECK (metodo_conversion_compras IN ('directa', 'triangulacion')),
    metodo_conversion_ventas VARCHAR(20) NOT NULL DEFAULT 'directa'
        CHECK (metodo_conversion_ventas IN ('directa', 'triangulacion')),
    auto_precio_compra BOOLEAN NOT NULL DEFAULT true,
    redondeo_activo BOOLEAN NOT NULL DEFAULT false,
    redondeo_multiplo DECIMAL(18, 2) NOT NULL DEFAULT 0.00 CHECK (redondeo_multiplo >= 0),
    redondeo_no_bajar_de_costo BOOLEAN NOT NULL DEFAULT true,
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ensanche idempotente (BD existentes): 'triangulacion' tiene 13 caracteres y
-- no cabía en el VARCHAR(12) original, lo que hacía fallar el guardado con
-- "value too long for type character varying(12)".
ALTER TABLE configuracion_global
    ALTER COLUMN metodo_conversion_compras TYPE VARCHAR(20),
    ALTER COLUMN metodo_conversion_ventas TYPE VARCHAR(20);

-- Las FKs a monedas se tipan según el id real de `monedas` (INTEGER en BD
-- nueva, UUID tras migrate-to-uuid.sql), igual que `productos.moneda_costo_id`.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'monedas'
          AND column_name = 'id' AND udt_name = 'uuid'
    ) THEN
        ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS
            moneda_transito_compras_id uuid REFERENCES monedas(id) ON DELETE SET NULL;
        ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS
            moneda_transito_ventas_id uuid REFERENCES monedas(id) ON DELETE SET NULL;
    ELSE
        ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS
            moneda_transito_compras_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL;
        ALTER TABLE configuracion_global ADD COLUMN IF NOT EXISTS
            moneda_transito_ventas_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION actualizar_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_configuracion_global_actualizado ON configuracion_global;
CREATE TRIGGER trg_configuracion_global_actualizado BEFORE UPDATE ON configuracion_global
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

-- Seed por defecto (Set & Forget): conversión directa, auto-precio ON,
-- redondeo OFF. El admin los cambia desde el panel por única vez.
INSERT INTO configuracion_global
    (id, metodo_conversion_compras, metodo_conversion_ventas,
     auto_precio_compra, redondeo_activo, redondeo_multiplo, redondeo_no_bajar_de_costo)
VALUES
    (1, 'directa', 'directa', true, false, 0.00, true)
ON CONFLICT (id) DO NOTHING;

-- Coherencia: el costo promedio ponderado es el método efectivamente
-- implementado; el valor legacy 'FIFO' de la UI quedaría engañoso.
UPDATE configuracion SET valor = 'Promedio'
WHERE clave = 'inventario_metodo_costeo' AND valor = 'FIFO';

-- ============================================================================
-- 2. PRODUCTOS: margen de ganancia + costo promedio ponderado (CPP)
-- ============================================================================
--   margen_ganancia       % que se suma al CPP para fijar el precio de venta.
--   costo_promedio        CPP por Unidad, en la moneda de COMPRA del producto
--                         (moneda_costo_id; NULL = la de venta).
--   costo_promedio_base   CPP por Unidad, en la moneda BASE del sistema (USD):
--                         ancla única para que compras en distintas monedas
--                         se consoliden matemáticamente sin ruido de tasas.
--   precio_auto           true si el precio_base actual fue fijado por el efecto
--                         cascada (no por edición manual). Lo usa el job de
--                         "recalcular precios" para no pisar precios manuales.
--   precio_actualizado_en auditoría de cuándo se fijó el último precio.
--
-- El backfill se hace UNA sola vez (solo si la columna no existía): el costo
-- estático actual pasa a ser el CPP inicial. `costo_promedio_base` queda 0:
-- el servicio trata 0 + stock>0 como "legacy sin conversión" y usa el costo
-- estático convertido como aproximación inicial (ver src/lib/costing.ts).
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'productos'
          AND column_name = 'costo_promedio'
    ) THEN
        ALTER TABLE productos ADD COLUMN costo_promedio DECIMAL(18, 6) NOT NULL DEFAULT 0.000000;
        ALTER TABLE productos ADD COLUMN costo_promedio_base DECIMAL(18, 6) NOT NULL DEFAULT 0.000000;
        ALTER TABLE productos ADD COLUMN margen_ganancia DECIMAL(5, 2) NOT NULL DEFAULT 0.00;
        ALTER TABLE productos ADD COLUMN precio_auto BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE productos ADD COLUMN precio_actualizado_en TIMESTAMP;

        COMMENT ON COLUMN productos.margen_ganancia IS 'Margen % para autocalcular precio de venta = costo_promedio x (1 + margen/100)';
        COMMENT ON COLUMN productos.costo_promedio IS 'CPP por unidad en la moneda de COMPRA del producto';
        COMMENT ON COLUMN productos.costo_promedio_base IS 'CPP por unidad en la moneda base del sistema (USD)';

        UPDATE productos SET costo_promedio = costo_base WHERE costo_base IS NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- 3. PRODUCTO_COSTOS_HISTORICOS  (autocompletado de costos futuros)
-- ============================================================================
-- Cada línea de compra registra aquí el costo ORIGINAL tal como se negoció
-- (presentación exacta y moneda de la factura). Al crear una compra el sistema
-- sugiere el costo más reciente por (producto, presentación, moneda) como
-- autocompletado. ON DELETE CASCADE: al anularse la compra se limpian sus
-- sugerencias (el rastro contable queda en kardex como 'compra_anulada').
-- ============================================================================
CREATE TABLE IF NOT EXISTS producto_costos_historicos (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    cantidad INTEGER NOT NULL,                 -- SIEMPRE en unidades base
    presentacion_id UUID REFERENCES producto_presentaciones(id) ON DELETE SET NULL,
    presentacion_nombre VARCHAR(100),          -- snapshot (ej. 'Caja')
    presentacion_unidades INTEGER,             -- snapshot (ej. 24)
    cantidad_presentaciones INTEGER,           -- ej. 1 caja
    costo_presentacion DECIMAL(18, 2),         -- costo negociado por presentación
    costo_unit DECIMAL(18, 6),                 -- derivado por unidad (moneda factura)
    costo_unit_base DECIMAL(18, 6),            -- por unidad en moneda base (USD)
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- FKs condicionales por tipo real de id (INTEGER vs UUID), patrón del proyecto.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'monedas'
          AND column_name = 'id' AND udt_name = 'uuid'
    ) THEN
        ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS
            moneda_id uuid REFERENCES monedas(id) ON DELETE RESTRICT;
    ELSE
        ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS
            moneda_id INTEGER REFERENCES monedas(id) ON DELETE RESTRICT;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'compras'
          AND column_name = 'id' AND udt_name = 'uuid'
    ) THEN
        ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS
            compra_id uuid REFERENCES compras(id) ON DELETE CASCADE;
    ELSE
        ALTER TABLE producto_costos_historicos ADD COLUMN IF NOT EXISTS
            compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- INDICES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_producto_costos_historicos_producto
    ON producto_costos_historicos(producto_id, fecha DESC, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_producto_costos_historicos_compra
    ON producto_costos_historicos(compra_id);

-- Los precios de presentación (Caja = Unidad x factor) NO requieren columnas:
-- ya se derivan en lectura desde precio_base (src/lib/money.ts
-- `presentacionesDeProducto`), que es exactamente el pricing bidireccional
-- pedido (la fuente de verdad es el precio por Unidad).