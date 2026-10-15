-- ============================================================================
-- POSBIT - Código de barras propio de las PRESENTACIONES (cajas, bolsas...)
-- ----------------------------------------------------------------------------
-- 1. Cada caja puede llevar su propio código de barras para escanearla y
--    cobrarla como caja, sin tener que elegirla a mano en el desplegable.
-- 2. Es OPCIONAL: NULL significa "esta caja no se escanea, solo se agrega
--    desde el desplegable". Varias cajas sin código conviven sin problema.
-- 3. Es ÚNICO EN TODO EL CATÁLOGO (case-insensitive): dos cajas distintas no
--    pueden compartir código, así el escaneo nunca es ambiguo. La colisión con
--    `productos.codigo` se valida en la API, porque un índice parcial no puede
--    abarcar dos tablas.
-- 4. NO cambia el inventario: el stock y el kardex siguen siendo en unidades.
--    El código es solo la forma de pedir "esta caja" en vez de "una unidad".
-- ============================================================================

ALTER TABLE producto_presentaciones
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(50) NULL;

COMMENT ON COLUMN producto_presentaciones.codigo IS
  'Código de barras propio de la caja. NULL = no escaneable, solo agregable desde el desplegable.';

-- Unicidad global parcial. `lower()` para que "ABC" y "abc" colisionen igual
-- que en el escaneo, que compara sin distinguir mayúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_presentaciones_codigo
  ON producto_presentaciones (lower(codigo))
  WHERE codigo IS NOT NULL;
