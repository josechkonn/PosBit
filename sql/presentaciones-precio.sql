-- ============================================================================
-- POSBIT - Presentaciones con PRECIO PROPIO (3 modos)
-- ----------------------------------------------------------------------------
-- Una presentación (caja, bolsa) es una forma de EMPAQUETAR y COTIZAR el mismo
-- producto. El inventario SIEMPRE vive en unidades, así que:
--
--   · El COSTO de la presentación NUNCA se guarda: se deriva del CPP × unidades
--     (si se guardara, dejaría de cuadrar con el kardex).
--   · El PRECIO de la presentación sí puede ser propio, porque es una decisión
--     comercial. Se define con `modo_venta`:
--
--       'derivado' → precio = precio_unidad × unidades
--                    (comportamiento actual; el margen es igual al del detalle)
--       'fijo'     → precio = precio_override (mayorista a precio acordado)
--       'margen'   → precio = CPP × unidades × (1 + margen_override/100)
--                    (se auto-ajusta con cada compra; el margen no se erosiona)
--
-- `NULL` en ambos overrides ⇒ modo 'derivado' ⇒ retrocompatible.
-- ============================================================================

ALTER TABLE producto_presentaciones
  ADD COLUMN IF NOT EXISTS modo_venta VARCHAR(10) NOT NULL DEFAULT 'derivado',
  ADD COLUMN IF NOT EXISTS precio_override NUMERIC(18, 6) NULL,
  ADD COLUMN IF NOT EXISTS margen_override NUMERIC(6, 3) NULL;

-- Restricciones de coherencia: cada modo solo usa los campos que le corresponden.
-- Se validan como CHECK para que un dato mal guardado no pueda existir.
ALTER TABLE producto_presentaciones
  DROP CONSTRAINT IF EXISTS chk_presentacion_modo_venta;
ALTER TABLE producto_presentaciones
  ADD CONSTRAINT chk_presentacion_modo_venta
  CHECK (modo_venta IN ('derivado', 'fijo', 'margen'));

ALTER TABLE producto_presentaciones
  DROP CONSTRAINT IF EXISTS chk_presentacion_precio_override;
ALTER TABLE producto_presentaciones
  ADD CONSTRAINT chk_presentacion_precio_override
  CHECK (
    (modo_venta <> 'fijo'  OR (precio_override IS NOT NULL AND precio_override >= 0)) AND
    (modo_venta <> 'margen' OR (margen_override IS NOT NULL AND margen_override >= 0))
  );

COMMENT ON COLUMN producto_presentaciones.modo_venta IS
  'derivado = precio_unidad × unidades | fijo = precio_override | margen = CPP × unidades × (1 + margen_override/100)';
COMMENT ON COLUMN producto_presentaciones.precio_override IS
  'Precio de VENTA propio de la presentación (solo si modo_venta = fijo). El COSTO nunca se guarda: se deriva del CPP.';
COMMENT ON COLUMN producto_presentaciones.margen_override IS
  'Margen % propio de la presentación (solo si modo_venta = margen). El precio se recalcula en cada lectura con el CPP vigente.';

-- ============================================================================
-- Snapshot de presentación en la línea de VENTA
-- ----------------------------------------------------------------------------
-- `cantidad` sigue siendo SIEMPRE unidades (igual que en compras), así que
-- kardex, anulación y reportes no cambian. La presentación es metadata + el
-- precio realmente cobrado, para poder mostrar "Caja x20 ×2 = 40 und." en un
-- reporte aunque luego se renombre o se dé de baja la presentación.
-- ============================================================================

ALTER TABLE venta_items
  ADD COLUMN IF NOT EXISTS presentacion_id UUID NULL REFERENCES producto_presentaciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS presentacion_nombre VARCHAR NULL,
  ADD COLUMN IF NOT EXISTS presentacion_unidades INTEGER NULL,
  ADD COLUMN IF NOT EXISTS cantidad_presentaciones NUMERIC(18, 6) NULL,
  ADD COLUMN IF NOT EXISTS precio_presentacion NUMERIC(18, 6) NULL;

CREATE INDEX IF NOT EXISTS idx_venta_items_presentacion ON venta_items(presentacion_id);

COMMENT ON COLUMN venta_items.cantidad IS
  'SIEMPRE en unidades (cantidad_presentaciones × presentacion_unidades). No cambiar este significado.';
COMMENT ON COLUMN venta_items.precio_unit IS
  'Precio unitario EFECTIVO cobrado = precio_presentacion ÷ presentacion_unidades. Permite reports por unidad sin conocer la presentación.';
COMMENT ON COLUMN venta_items.precio_presentacion IS
  'Precio real cobrado por la presentación completa (snapshot del momento de la venta).';