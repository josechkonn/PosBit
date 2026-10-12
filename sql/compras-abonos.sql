-- ============================================================================
-- POSBIT - Sistema de Abonos y Deudas de Compras (multicurrency)
-- ============================================================================
-- 1. Extender tabla compras con estado de pago y saldo pendiente
-- 2. Tabla compra_abonos con trazabilidad completa de tasas
-- 3. Vista de deuda por proveedor
-- ============================================================================

-- 1. Estados de pago válidos (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_pago_compra') THEN
    CREATE TYPE estado_pago_compra AS ENUM ('pagado', 'parcial', 'pendiente');
  END IF;
END $$;

-- 2. Extender compras
ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS estado_pago estado_pago_compra NOT NULL DEFAULT 'pagado',
  ADD COLUMN IF NOT EXISTS saldo_pendiente NUMERIC(18, 6) NOT NULL DEFAULT 0;

-- Índice para consultas de deuda
CREATE INDEX IF NOT EXISTS idx_compras_estado_pago ON compras(estado_pago);
CREATE INDEX IF NOT EXISTS idx_compras_proveedor_estado ON compras(proveedor_id, estado_pago);

-- 3. Tabla de abonos (pagos parciales/posteriores)
CREATE TABLE IF NOT EXISTS compra_abonos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id UUID NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Monto en la moneda EN QUE SE PAGA (puede ser distinta a la de la compra)
  monto NUMERIC(18, 6) NOT NULL,
  moneda_id UUID NOT NULL REFERENCES monedas(id),
  -- Tasa de cambio al momento del abono: unidades de moneda_abono por 1 USD
  tasa_cambio NUMERIC(18, 6) NOT NULL,
  -- Monto en moneda BASE (USD) para consolidar deuda
  monto_base NUMERIC(18, 6) NOT NULL,
  metodo_pago_id UUID REFERENCES metodos_pago(id),
  caja_id UUID REFERENCES cajas(id),
  observaciones TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compra_abonos_compra ON compra_abonos(compra_id);
CREATE INDEX IF NOT EXISTS idx_compra_abonos_fecha ON compra_abonos(fecha);

-- 4. Trigger para actualizado_en en compra_abonos
CREATE OR REPLACE FUNCTION set_actualizado_en_compra_abonos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_compra_abonos_actualizado_en ON compra_abonos;
CREATE TRIGGER trg_compra_abonos_actualizado_en
  BEFORE UPDATE ON compra_abonos
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en_compra_abonos();

-- 5. Función helper: recalcular saldo_pendiente de una compra
CREATE OR REPLACE FUNCTION recalcular_saldo_compra(p_compra_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE
  v_total_base NUMERIC;
  v_abonos_base NUMERIC;
  v_saldo NUMERIC;
BEGIN
  SELECT total_base INTO v_total_base FROM compras WHERE id = p_compra_id;
  SELECT COALESCE(SUM(monto_base), 0) INTO v_abonos_base
  FROM compra_abonos WHERE compra_id = p_compra_id;
  v_saldo := GREATEST(v_total_base - v_abonos_base, 0);
  UPDATE compras
  SET saldo_pendiente = v_saldo,
      estado_pago = CASE
        WHEN v_saldo <= 0.000001 THEN 'pagado'::estado_pago_compra
        WHEN v_abonos_base > 0 THEN 'parcial'::estado_pago_compra
        ELSE 'pendiente'::estado_pago_compra
      END,
      actualizado_en = NOW()
  WHERE id = p_compra_id;
  RETURN v_saldo;
END $$;

-- 6. Trigger: al insertar/actualizar/borrar abono, recalcular saldo
CREATE OR REPLACE FUNCTION trg_compra_abonos_recalcular_saldo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_compra_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_compra_id := OLD.compra_id;
  ELSE
    v_compra_id := NEW.compra_id;
  END IF;
  PERFORM recalcular_saldo_compra(v_compra_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_compra_abonos_after_insert ON compra_abonos;
CREATE TRIGGER trg_compra_abonos_after_insert
  AFTER INSERT ON compra_abonos
  FOR EACH ROW EXECUTE FUNCTION trg_compra_abonos_recalcular_saldo();

DROP TRIGGER IF EXISTS trg_compra_abonos_after_update ON compra_abonos;
CREATE TRIGGER trg_compra_abonos_after_update
  AFTER UPDATE ON compra_abonos
  FOR EACH ROW EXECUTE FUNCTION trg_compra_abonos_recalcular_saldo();

DROP TRIGGER IF EXISTS trg_compra_abonos_after_delete ON compra_abonos;
CREATE TRIGGER trg_compra_abonos_after_delete
  AFTER DELETE ON compra_abonos
  FOR EACH ROW EXECUTE FUNCTION trg_compra_abonos_recalcular_saldo();

-- 7. Vista: Deuda consolidada por proveedor (en USD/base)
CREATE OR REPLACE VIEW vista_deuda_proveedores AS
SELECT
  p.id AS proveedor_id,
  p.nombre AS proveedor_nombre,
  p.rif AS proveedor_rif,
  COALESCE(SUM(c.saldo_pendiente), 0) AS deuda_total_base,
  COUNT(c.id) FILTER (WHERE c.estado_pago <> 'pagado') AS compras_pendientes,
  MIN(c.fecha) FILTER (WHERE c.estado_pago <> 'pagado') AS fecha_mas_antigua
FROM proveedores p
LEFT JOIN compras c ON c.proveedor_id = p.id AND c.estado_pago <> 'pagado'
WHERE p.activo = true
GROUP BY p.id, p.nombre, p.rif
HAVING COALESCE(SUM(c.saldo_pendiente), 0) > 0.000001;

-- 8. Vista: Detalle de deuda por compra (para UI)
CREATE OR REPLACE VIEW vista_deuda_compras AS
SELECT
  c.id,
  c.numero,
  c.fecha,
  c.proveedor_id,
  p.nombre AS proveedor_nombre,
  c.moneda_id,
  m.codigo AS moneda_codigo,
  m.simbolo AS moneda_simbolo,
  c.total,
  c.total_base,
  c.saldo_pendiente,
  c.estado_pago,
  COALESCE((
    SELECT JSON_AGG(
      JSON_BUILD_OBJECT(
        'id', a.id,
        'fecha', a.fecha,
        'monto', a.monto,
        'moneda_id', a.moneda_id,
        'moneda_codigo', ma.codigo,
        'moneda_simbolo', ma.simbolo,
        'tasa_cambio', a.tasa_cambio,
        'monto_base', a.monto_base,
        'metodo_pago_id', a.metodo_pago_id,
        'caja_id', a.caja_id,
        'observaciones', a.observaciones,
        'creado_en', a.creado_en
      ) ORDER BY a.fecha, a.creado_en
    )
    FROM compra_abonos a
    LEFT JOIN monedas ma ON ma.id = a.moneda_id
    WHERE a.compra_id = c.id
  ), '[]'::json) AS abonos
FROM compras c
JOIN proveedores p ON p.id = c.proveedor_id
JOIN monedas m ON m.id = c.moneda_id
WHERE c.estado_pago <> 'pagado';

-- 9. Seed: actualizar compras existentes (asumir pagadas si no hay abonos)
-- Primero normalizar valores existentes a minúsculas (cast a text)
UPDATE compras
SET estado_pago = LOWER(estado_pago::text)::estado_pago_compra
WHERE estado_pago IS NOT NULL;

UPDATE compras
SET estado_pago = 'pagado', saldo_pendiente = 0
WHERE estado_pago IS NULL;

-- 10. Comentarios
COMMENT ON COLUMN compras.estado_pago IS 'pagado | parcial | pendiente';
COMMENT ON COLUMN compras.saldo_pendiente IS 'Saldo en moneda BASE (USD) pendiente de pagar';
COMMENT ON TABLE compra_abonos IS 'Abonos a compras (pueden ser en moneda distinta a la compra). Cada abono guarda su tasa de cambio histórica.';
COMMENT ON COLUMN compra_abonos.tasa_cambio IS 'Unidades de moneda_abono por 1 USD al momento del abono';
COMMENT ON COLUMN compra_abonos.monto_base IS 'Monto del abono convertido a moneda base (USD) para consolidar deuda';