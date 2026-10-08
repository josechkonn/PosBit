// ============================================================================
// POSBIT - Verificación de integridad del seed de demostración
//   - Stock de productos <-> Kardex (saldo_actual final)
//   - Saldos de caja <-> Suma de transacciones
//   - Créditos: saldo = monto_total - abonos, estado coherente
//   - Ventas/Compras <-> sus items (subtotal)
//   - Alertas de stock bajo
//   - Dashboard: cada moneda activa con ventas en el mes actual (>= 2 meses en el gráfico)
// Uso: node scripts/verify-seed.cjs
// ============================================================================
require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env.local") });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let errores = 0;
let avisos = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function error(msg) {
  errores += 1;
  console.log(`  ✗ ERROR: ${msg}`);
}
function warn(msg) {
  avisos += 1;
  console.log(`  ⚠ AVISO: ${msg}`);
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function main() {
  // --- 1. Conteo de tablas ---
  console.log("\n== Conteo de registros ==");
  const tables = [
    "monedas", "categorias", "marcas", "proveedores", "clientes", "productos",
    "producto_precios", "cajas", "metodos_pago", "compras", "compra_items",
    "ventas", "venta_items", "creditos", "retornos", "retorno_items",
    "abonos", "kardex", "transacciones", "cierres_caja", "configuracion",
  ];
  for (const t of tables) {
    const res = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
    const n = Number(res.rows[0].n);
    if (n > 0) ok(`${t}: ${n}`);
    else warn(`${t}: 0 registros`);
  }

  // --- 2. Stock <-> Kardex ---
  console.log("\n== Stock productos vs Kardex ==");
  const kardex = await pool.query(`
    SELECT k.producto_id, k.saldo_actual
    FROM kardex k
    WHERE k.id = (SELECT MAX(k2.id) FROM kardex k2 WHERE k2.producto_id = k.producto_id)
  `);
  const kardexMap = new Map(kardex.rows.map((r) => [r.producto_id, round2(r.saldo_actual)]));
  const productos = await pool.query(`SELECT id, codigo, nombre, stock FROM productos`);
  for (const p of productos.rows) {
    const kSaldo = kardexMap.get(p.id);
    if (kSaldo === undefined) {
      error(`Producto ${p.codigo} sin movimientos de kardex (stock=${p.stock})`);
    } else if (round2(p.stock) !== kSaldo) {
      error(`Stock inconsistente en ${p.codigo} (${p.nombre}): stock=${p.stock}, kardex final=${kSaldo}`);
    }
  }
  if (productos.rows.length > 0) ok(`Stock<->Kardex coherente en ${productos.rows.length} productos`);

  // --- 3. Cajas <-> Transacciones ---
  console.log("\n== Saldos de caja vs Transacciones ==");
  const cajas = await pool.query(`
    SELECT c.id, c.nombre, c.saldo_actual, m.codigo
    FROM cajas c JOIN monedas m ON c.moneda_id = m.id
  `);
  for (const c of cajas.rows) {
    const t = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN tipo = 'Entrada' THEN monto ELSE 0 END), 0) AS ent,
             COALESCE(SUM(CASE WHEN tipo = 'Salida' THEN monto ELSE 0 END), 0) AS sal
      FROM transacciones WHERE caja_id = $1`, [c.id]);
    const saldoCalc = round2(Number(t.rows[0].ent) - Number(t.rows[0].sal));
    if (round2(c.saldo_actual) !== saldoCalc) {
      error(`Caja ${c.nombre} (${c.codigo}): saldo=${c.saldo_actual}, transacciones=${saldoCalc}`);
    } else {
      ok(`Caja ${c.nombre} (${c.codigo}): ${saldoCalc} ${c.codigo}`);
    }
  }

  // --- 4. Créditos: saldo y estado ---
  console.log("\n== Créditos: saldo/estado ==");
  const creditos = await pool.query(`
    SELECT cr.id, cr.numero, cr.monto_total, cr.saldo, cr.estado, m.codigo AS moneda,
           COALESCE((SELECT SUM(ab.monto) FROM abonos ab WHERE ab.credito_id = cr.id), 0) AS abonado
    FROM creditos cr JOIN monedas m ON cr.moneda_id = m.id
  `);
  for (const cr of creditos.rows) {
    const saldoCalc = round2(Number(cr.monto_total) - Number(cr.abonado));
    const estadoEsperado = saldoCalc <= 0.01 ? "Pagado" : "Parcial";
    if (round2(cr.saldo) !== saldoCalc) {
      error(`${cr.numero}: saldo=${cr.saldo}, esperado=${saldoCalc} (monto ${cr.monto_total} - abonos ${cr.abonado})`);
    } else if (cr.estado !== estadoEsperado) {
      error(`${cr.numero}: estado=${cr.estado}, esperado=${estadoEsperado}`);
    } else {
      ok(`${cr.numero} (${cr.moneda}): saldo=${cr.saldo}, estado=${cr.estado}`);
    }
  }

  // --- 5. Ventas <-> Items ---
  console.log("\n== Ventas vs Items ==");
  const ventas = await pool.query(`
    SELECT v.id, v.numero, v.total,
           COALESCE((SELECT SUM(vi.subtotal) FROM venta_items vi WHERE vi.venta_id = v.id), 0) AS items_sum
    FROM ventas v
  `);
  for (const v of ventas.rows) {
    const itemsSum = round2(v.items_sum);
    if (Math.abs(round2(v.total) - itemsSum) > 0.01) {
      error(`${v.numero}: total=${v.total}, suma items=${itemsSum}`);
    }
  }
  if (ventas.rows.length > 0) ok(`Ventas<->Items coherentes en ${ventas.rows.length} ventas`);

  // --- 6. Compras <-> Items ---
  console.log("\n== Compras vs Items ==");
  const compras = await pool.query(`
    SELECT c.id, c.numero, c.total,
           COALESCE((SELECT SUM(ci.subtotal) FROM compra_items ci WHERE ci.compra_id = c.id), 0) AS items_sum
    FROM compras c
  `);
  for (const c of compras.rows) {
    const itemsSum = round2(c.items_sum);
    if (Math.abs(round2(c.total) - itemsSum) > 0.01) {
      error(`${c.numero}: total=${c.total}, suma items=${itemsSum}`);
    }
  }
  if (compras.rows.length > 0) ok(`Compras<->Items coherentes en ${compras.rows.length} compras`);

  // --- 7. Alertas de stock bajo ---
  console.log("\n== Alertas de stock ==");
  const alertas = await pool.query(`
    SELECT codigo, nombre, stock, stock_minimo FROM productos
    WHERE activo = true AND stock <= stock_minimo ORDER BY stock ASC
  `);
  if (alertas.rows.length > 0) {
    for (const a of alertas.rows) {
      warn(`${a.codigo} ${a.nombre}: stock ${a.stock} <= mínimo ${a.stock_minimo}`);
    }
  } else {
    ok("Sin alertas de stock");
  }

  // --- 8. Dashboard por moneda: ventas en mes actual y >= 2 meses en el gráfico ---
  console.log("\n== Dashboard por moneda (mes actual) ==");
  const monedas = await pool.query(`SELECT id, codigo FROM monedas WHERE activo = true ORDER BY es_base DESC, codigo ASC`);
  for (const m of monedas.rows) {
    const vMes = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS total
       FROM ventas WHERE estado = 'Pagada' AND moneda_id = $1
       AND fecha >= date_trunc('month', CURRENT_DATE)`, [m.id]);
    const meses = await pool.query(
      `SELECT COUNT(DISTINCT TO_CHAR(fecha, 'YYYY-MM')) AS n FROM ventas
       WHERE estado = 'Pagada' AND moneda_id = $1 AND fecha >= CURRENT_DATE - INTERVAL '6 months'`, [m.id]);
    const vMesN = Number(vMes.rows[0].n);
    const vMesTotal = round2(vMes.rows[0].total);
    const mesesN = Number(meses.rows[0].n);
    const estado = vMesN > 0 && mesesN >= 2 ? ok : (vMesN === 0 ? warn : warn);
    estado(`${m.codigo}: ventas mes actual=${vMesN} (${vMesTotal}), meses con ventas=${mesesN}`);
  }

  console.log("\n" + (errores === 0 ? "RESULTADO: VERIFICACIÓN COMPLETADA SIN ERRORES" : `RESULTADO: ${errores} ERROR(ES) ENCONTRADOS`) + (avisos > 0 ? ` (${avisos} aviso(s))` : ""));
  process.exitCode = errores > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("Error ejecutando la verificación:", e);
  process.exit(1);
}).finally(() => pool.end());
