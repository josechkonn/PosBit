-- ============================================================================
-- POSBIT - Descuentos en compras (por línea encadenados + general de factura)
-- ----------------------------------------------------------------------------
-- 1. Cada ítem admite DOS descuentos encadenados (%), el 2º se aplica sobre el
--    resultado del 1º (concepto de "descuento sobre descuento").
-- 2. La compra admite un descuento general (%) que se aplica sobre el total
--    de los ítems ya descontados.
-- 3. Se guarda el costo neto final para que el CPP use el costo REAL pagado
--    (con descuento) y no el precio de lista.
-- ============================================================================

-- ── Descuentos por ítem ────────────────────────────────────────────────────
ALTER TABLE compra_items
  ADD COLUMN IF NOT EXISTS descuento1_pct NUMERIC(6, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento2_pct NUMERIC(6, 3) NOT NULL DEFAULT 0,
  -- Subtotal de lista (antes de descuentos)
  ADD COLUMN IF NOT EXISTS subtotal_bruto NUMERIC(18, 6) NOT NULL DEFAULT 0,
  -- Descuento en dinero ya aplicado (subtotal_bruto - subtotal)
  ADD COLUMN IF NOT EXISTS descuento_monto NUMERIC(18, 6) NOT NULL DEFAULT 0;

COMMENT ON COLUMN compra_items.descuento1_pct IS 'Primer descuento % del ítem';
COMMENT ON COLUMN compra_items.descuento2_pct IS 'Segundo descuento % (aplicado sobre el resultado del 1º)';
COMMENT ON COLUMN compra_items.subtotal_bruto IS 'Subtotal de lista antes de descuentos';
COMMENT ON COLUMN compra_items.descuento_monto IS 'Monto de descuento total del ítem (bruto - neto)';

-- ── Descuento general de la factura ───────────────────────────────────────
ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS descuento_pct NUMERIC(6, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_monto NUMERIC(18, 6) NOT NULL DEFAULT 0;

COMMENT ON COLUMN compras.descuento_pct IS 'Descuento general % aplicado al total de los ítems ya descontados';
COMMENT ON COLUMN compras.descuento_monto IS 'Monto del descuento general en moneda de la compra';

-- ── Índices útiles para reportes ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_compra_items_descuentos ON compra_items(compra_id);