-- ============================================================================
-- PRODUCTO ⇄ PROVEEDOR (relación N:M)
-- ----------------------------------------------------------------------------
-- Un producto puede surtirse de VARIOS proveedores y un proveedor puede
-- suministrar varios productos. La tabla puente es la fuente de verdad; la
-- columna legacy `productos.proveedor_id` (proveedor principal) se mantiene
-- sincronizada con el PRIMER proveedor de la lista por compatibilidad.
--
-- `productos.id` SIEMPRE es INTEGER (decisión del proyecto); `proveedores.id`
-- es INTEGER en BD nueva y UUID en las ya migradas (migrate-to-uuid.sql), así
-- que el tipo de la FK se elige según el tipo real de `proveedores.id`.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'producto_proveedores'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'proveedores'
              AND column_name = 'id' AND udt_name = 'uuid'
        ) THEN
            CREATE TABLE producto_proveedores (
                producto_id  INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
                proveedor_id uuid NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
                PRIMARY KEY (producto_id, proveedor_id)
            );
        ELSE
            CREATE TABLE producto_proveedores (
                producto_id  INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
                proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
                PRIMARY KEY (producto_id, proveedor_id)
            );
        END IF;
    END IF;
END $$;

-- Backfill: los productos con proveedor principal (legacy) pasan a la lista.
INSERT INTO producto_proveedores (producto_id, proveedor_id)
SELECT id, proveedor_id FROM productos WHERE proveedor_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_producto_proveedores_proveedor
    ON producto_proveedores (proveedor_id);