-- ============================================================================
-- POSBIT - Cobros extra de la venta (delivery, bolsa, propina, servicio...)
-- ----------------------------------------------------------------------------
-- 1. Cada venta admite N cobros extra con concepto + monto. NO llevan IVA y se
--    suman tal cual al total: total = subtotal - descuentos + IVA + cobros.
-- 2. `concepto` es un snapshot del texto escrito en el modal, para que el ticket
--    histórico siga siendo legible aunque el backend cambie de concepto.
-- 3. El monto se guarda en la MONEDA DE LA VENTA (el POS lo convierte antes de
--    enviarlo) y su equivalente en USD en `monto_base`, para que reportes y
--    dashboard no tengan que depender de la tasa vigente hoy.
-- ============================================================================

-- ── Totales en la cabecera de la venta ─────────────────────────────────────
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS cobros_extra      DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS cobros_extra_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN ventas.cobros_extra IS 'Suma de los cobros extra de la venta, en la moneda de la venta';
COMMENT ON COLUMN ventas.cobros_extra_base IS 'Suma de los cobros extra de la venta, en USD';

-- ── Detalle de los cobros ─────────────────────────────────────────────────
-- `venta_id` copia el tipo de `ventas.id`: INTEGER en una base recién creada
-- con schema.sql y UUID después de migrate-to-uuid.sql (mismo criterio que
-- `configuracion_global.moneda_transito_*`).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ventas'
          AND column_name = 'id' AND udt_name = 'uuid'
    ) THEN
        CREATE TABLE IF NOT EXISTS venta_cobros_extra (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
            concepto VARCHAR(150) NOT NULL,
            monto DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
            monto_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
            creado_en TIMESTAMP NOT NULL DEFAULT NOW()
        );
    ELSE
        CREATE TABLE IF NOT EXISTS venta_cobros_extra (
            id SERIAL PRIMARY KEY,
            venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
            concepto VARCHAR(150) NOT NULL,
            monto DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
            monto_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
            creado_en TIMESTAMP NOT NULL DEFAULT NOW()
        );
    END IF;
END $$;

COMMENT ON TABLE venta_cobros_extra IS 'Cobros extra cobrados junto a la venta (delivery, bolsa, propina, servicio)';

CREATE INDEX IF NOT EXISTS idx_venta_cobros_extra_venta ON venta_cobros_extra(venta_id);
