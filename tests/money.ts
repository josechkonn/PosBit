// Pruebas numéricas de src/lib/money.ts (la fuente de verdad de las fórmulas).
// Correr con: npm run test:money   (Node ≥ 22.6 con strip-types, o ≥ 23)
import { tasaUsd, convertir, tasaUsdDocumento, aBase, desdeBase, redondear, tasaPar, preciosDeProducto, reglasConversion, precioPresentacion, precioUnidadDesdePresentacion, presentacionesDeProducto, margenSobreCosto, aplicarDescuentosLinea, calcularTotalConDescuentos, precioPresentacionSegunModo } from "../src/lib/money.ts";

const catalogo: any[] = [
  { id: 1, codigo: "USD", simbolo: "$", tasa: 1, decimales: 2, es_base: true, tasa_ref_moneda_id: null },
  { id: 2, codigo: "VES", simbolo: "Bs", tasa: 892.2342, decimales: 2, es_base: false, tasa_ref_moneda_id: null },
  { id: 3, codigo: "COP", simbolo: "$", tasa: 3.2, decimales: 2, es_base: false, tasa_ref_moneda_id: 2 },
];
const [USD, VES, COP] = catalogo;

let fallos = 0;
function check(nombre: string, real: number, esperado: number, tol = 0.01) {
  const ok = Math.abs(real - esperado) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FAIL"} ${nombre}: real=${real} esperado=${esperado}`);
}
function checkTrue(nombre: string, cond: boolean) {
  if (!cond) fallos++;
  console.log(`${cond ? "OK  " : "FAIL"} ${nombre}`);
}

console.log("── tasaUsd (unidades por 1 USD) ──");
check("USD", tasaUsd(USD, catalogo), 1, 1e-9);
check("VES/BS", tasaUsd(VES, catalogo), 892.2342, 1e-9);
check("COP = 3.2 × 892.2342", tasaUsd(COP, catalogo), 2855.14944, 1e-6);

console.log("\n── convertir ──");
check("100.000 COP → USD (35,02)", convertir(100000, COP, USD, catalogo), 35.02);
check("100.000 COP → BS (31.250)", convertir(100000, COP, VES, catalogo), 31250);
check("100 BS → COP (320)", convertir(100, VES, COP, catalogo), 320);
check("1 USD → COP (2.855,15)", convertir(1, USD, COP, catalogo), 2855.15);
check("1 USD → BS (892,23)", convertir(1, USD, VES, catalogo), 892.23);
check("100 USD → BS (89.223,42)", convertir(100, USD, VES, catalogo), 89223.42);
check("1000 BS → USD (1,12)", convertir(1000, VES, USD, catalogo), 1.12);
check("COP → COP sin cambio", convertir(5000, COP, COP, catalogo), 5000, 1e-9);

console.log("\n── tasaUsdDocumento (tasa personalizada) ──");
// COP personalizada 3.1 → 3.1 × 892.2342 por USD
check("COP custom 3.1 → USD rate", tasaUsdDocumento(COP, 3.1, catalogo), 3.1 * 892.2342, 1e-6);
check("COP sin custom → default", tasaUsdDocumento(COP, null, catalogo), 2855.14944, 1e-6);
check("VES custom 900 → USD rate", tasaUsdDocumento(VES, 900, catalogo), 900, 1e-9);
check("COP custom 3.1: 100.000 COP → BS", (100000 / tasaUsdDocumento(COP, 3.1, catalogo)) * tasaUsd(VES, catalogo), 100000 / 3.1, 0.01);

console.log("\n── aBase / desdeBase (ida y vuelta a USD) ──");
const tasaUsdDoc = tasaUsdDocumento(COP, null, catalogo);
const ida = aBase(100000, tasaUsdDoc);
check("100.000 COP → USD", ida, 35.02);
// El ida y vuelta pierde ~0.01% porque USD se guarda con 2 decimales
check("y de vuelta → COP", desdeBase(ida, tasaUsdDoc), 100000, 15);

console.log("\n── conversión directa a USD (COP ↔ USD) ──");
const catalogoDirecto: any[] = [
  { id: 1, codigo: "USD", simbolo: "$", tasa: 1, decimales: 2, es_base: true, tasa_ref_moneda_id: null },
  { id: 2, codigo: "VES", simbolo: "Bs", tasa: 892.2342, decimales: 2, es_base: false, tasa_ref_moneda_id: null },
  { id: 3, codigo: "COP", simbolo: "$", tasa: 3.2, decimales: 2, es_base: false, tasa_ref_moneda_id: 2, usa_tasa_usd_directa: true, tasa_usd_directa: 3200 },
];
const COPd = catalogoDirecto[2];
check("tasaUsd COP directa", tasaUsd(COPd, catalogoDirecto), 3200, 1e-9);
check("100.000 COP → USD (31,25 con tasa directa)", convertir(100000, COPd, USD, catalogoDirecto), 31.25);
check("1 USD → COP (3.200)", convertir(1, USD, COPd, catalogoDirecto), 3200, 1e-9);
// COP ↔ BS sigue usando el 3.2 aunque haya tasa directa a USD
check("100.000 COP → BS (31.250 con 3.2)", convertir(100000, COPd, VES, catalogoDirecto), 31250);
check("100 BS → COP (320 con 3.2)", convertir(100, VES, COPd, catalogoDirecto), 320);
// Tasa personalizada en modo directo = unidades por 1 USD
check("COP directa custom 3100 → USD rate", tasaUsdDocumento(COPd, 3100, catalogoDirecto), 3100, 1e-9);
check("COP directa sin custom → 3200", tasaUsdDocumento(COPd, null, catalogoDirecto), 3200, 1e-9);

console.log("\n── tasaPar (factor por par, arista directa preferida) ──");
check("BS → COP directa = 3.2", tasaPar(VES, COPd, catalogoDirecto), 3.2, 1e-9);
check("COP → BS directa = 0.3125", tasaPar(COPd, VES, catalogoDirecto), 0.3125, 1e-9);
check("USD → COP directa = 3200", tasaPar(USD, COPd, catalogoDirecto), 3200, 1e-9);
check("COP → USD directa = 1/3200", tasaPar(COPd, USD, catalogoDirecto), 1 / 3200, 1e-9);
// efectiva (tasa personalizada por USD): no toca el par COP↔BS, sí COP↔USD
check("BS → COP con custom 3100 = 3.2 (fija)", tasaPar(VES, COPd, catalogoDirecto, { [String(COPd.id)]: 3100 }), 3.2, 1e-9);
check("USD → COP con custom 3100 = 3100", tasaPar(USD, COPd, catalogoDirecto, { [String(COPd.id)]: 3100 }), 3100, 1e-9);
// efectiva en modo cadena: custom COP/VES sí cambia el par con BS
check("BS → COP cadena custom 3.1 = 3.1", tasaPar(VES, COP, catalogo, { [String(COP.id)]: 3.1 * 892.2342 }), 3.1, 1e-9);

console.log("\n── redondear ──");
check("redondear 35.0244", redondear(35.0244), 35.02, 1e-9);
check("redondear 1.005 (sin error flotante)", redondear(1.005), 1.01, 1e-9);

console.log("\n── preciosDeProducto (derivación dinámica en lectura) ──");
const productoCOP = { precio_base: 100000, costo_base: 80000, moneda_base_id: "3" }; // COP
const preciosCOP = preciosDeProducto(productoCOP, catalogo, USD);
const pUSD = preciosCOP.find((p) => p.moneda_codigo === "USD");
const pCOP = preciosCOP.find((p) => p.moneda_codigo === "COP");
const pVES = preciosCOP.find((p) => p.moneda_codigo === "VES");
check("precios: fila base COP mantiene valor", pCOP?.precio ?? 0, 100000, 1e-9);
check("precios: USD derivado desde COP", pUSD?.precio ?? 0, 35.02, 0.01);
check("precios: VES derivado desde COP (3.2)", pVES?.precio ?? 0, 31250, 0.1);
const precioBSProducto = preciosCOP.find((p) => p.moneda_codigo === "VES");
check("precios: costo VES deriva", precioBSProducto?.costo ?? 0, convertir(80000, COP, VES, catalogo), 1);

const productoUSD = { precio_base: 10, costo_base: 8, moneda_base_id: null }; // sin base → default USD
const preciosUSD = preciosDeProducto(productoUSD, catalogo, USD);
const pUSDb = preciosUSD.find((p) => p.moneda_codigo === "USD");
check("precios: sin base → USD fijo", pUSDb?.precio ?? 0, 10, 1e-9);
const pCOPb = preciosUSD.find((p) => p.moneda_codigo === "COP");
check("precios: COP deriva desde USD", pCOPb?.precio ?? 0, 28551.49, 0.2);

console.log("\n── preciosDeProducto (moneda de COMPRA independiente) ──");
// Venta en COP, costo en USD (caso típico: se compra en USD, se vende en COP)
const productoMixto = { precio_base: 100000, costo_base: 8, moneda_base_id: "3", moneda_costo_id: "1" };
const preciosMixto = preciosDeProducto(productoMixto, catalogo, USD);
const mCOP = preciosMixto.find((p) => p.moneda_codigo === "COP");
const mUSD = preciosMixto.find((p) => p.moneda_codigo === "USD");
const mVES = preciosMixto.find((p) => p.moneda_codigo === "VES");
check("mixto: precio en COP (moneda de venta) es exacto", mCOP?.precio ?? 0, 100000, 1e-9);
check("mixto: precio en USD deriva de COP", mUSD?.precio ?? 0, 35.02, 0.01);
check("mixto: costo en USD (moneda de compra) es exacto", mUSD?.costo ?? 0, 8, 1e-9);
check("mixto: costo en COP deriva de USD", mCOP?.costo ?? 0, convertir(8, USD, COP, catalogo), 0.01);
check("mixto: costo en VES deriva de USD", mVES?.costo ?? 0, convertir(8, USD, VES, catalogo), 0.01);
check("mixto: es_base marca la moneda de VENTA", Number(mCOP?.es_base ?? false), 1, 1e-9);
check("mixto: la moneda de COMPRA no es es_base", Number(mUSD?.es_base ?? true), 0, 1e-9);

// Retrocompatible: sin moneda_costo_id el costo sigue en la moneda de venta
const preciosSinCosto = preciosDeProducto(
  { precio_base: 100000, costo_base: 80000, moneda_base_id: "3" },
  catalogo,
  USD
);
const sCOP = preciosSinCosto.find((p) => p.moneda_codigo === "COP");
const sUSD = preciosSinCosto.find((p) => p.moneda_codigo === "USD");
check("retro: sin moneda_costo_id el costo COP es exacto", sCOP?.costo ?? 0, 80000, 1e-9);
check("retro: sin moneda_costo_id el costo USD deriva de COP", sUSD?.costo ?? 0, 28.02, 0.01);

console.log("\n── reglasConversion (motor Set & Forget) ──");
const reglasTri = reglasConversion(
  {
    metodo_conversion_compras: "triangulacion",
    metodo_conversion_ventas: "triangulacion",
    moneda_transito_compras_id: "2", // VES
    moneda_transito_ventas_id: "2",
  },
  catalogoDirecto
);
checkTrue("reglas: compras = triangulación", reglasTri.compras.metodo === "triangulacion");
checkTrue("reglas: ventas = triangulación", reglasTri.ventas.metodo === "triangulacion");
checkTrue("reglas: tránsito compras resuelto a VES", reglasTri.compras.monedaTransito?.codigo === "VES");
checkTrue("reglas: tránsito ventas resuelto a VES", reglasTri.ventas.monedaTransito?.codigo === "VES");
const reglasVacio = reglasConversion(null, catalogoDirecto);
checkTrue("reglas: sin config → directa (retrocompatible)", reglasVacio.compras.metodo === "directa" && reglasVacio.ventas.metodo === "directa");
checkTrue("reglas: sin config → sin tránsito", reglasVacio.compras.monedaTransito === null);

console.log("\n── preciosDeProducto con triangulación (USD↔COP vía VES) ──");
// Ventas en COP (id 3), costo en USD (id 1). Con COP de tasa directa 3200:
//   directa USD→COP = 3200 · triangulación USD→VES→COP = 892.2342 × 3.2 = 2855.14944
const prodTri = { precio_base: 2855149.44, costo_base: 8, moneda_base_id: "3", moneda_costo_id: "1" };
const preciosTri = preciosDeProducto(prodTri, catalogoDirecto, USD, reglasTri);
const triUSD = preciosTri.find((p) => p.moneda_codigo === "USD");
const triCOP = preciosTri.find((p) => p.moneda_codigo === "COP");
check("tri: precio COP→USD por tránsito VES (≈1000)", triUSD?.precio ?? 0, 2855149.44 / (892.2342 * 3.2), 0.5);
check("tri: costo USD (moneda de compra) exacto", triUSD?.costo ?? 0, 8, 1e-9);
check("tri: costo USD→COP por tránsito VES (8×2855.15)", triCOP?.costo ?? 0, 8 * (892.2342 * 3.2), 0.5);
// Sin reglas = comportamiento histórico directo (USD→COP usa la tasa directa 3200)
const preciosDir = preciosDeProducto(prodTri, catalogoDirecto, USD);
const dirUSD = preciosDir.find((p) => p.moneda_codigo === "USD");
check("directa: precio COP→USD por par directo (≈892.23)", dirUSD?.precio ?? 0, 2855149.44 / 3200, 0.05);


console.log("\n── presentaciones (derivación precio unitario ⇄ presentación) ──");
// Caja de 24 con precio unitario 100 → caja = 2400
check("precio caja = 100×24", precioPresentacion(100, 24), 2400, 1e-9);
// Caja a 2400 / 24 → unitario 100 (ida y vuelta)
check("precio unidad = 2400/24", precioUnidadDesdePresentacion(2400, 24), 100, 1e-9);
// Precio unitario con decimales que no dividen exacto: 40000 ÷ 24 = 1666.67 (redondeo)
check("unidad despejada 40000/24", precioUnidadDesdePresentacion(40000, 24), 1666.67, 1e-9);
// Re-derivación de la caja desde el unitario redondeado: 1666.67 × 24 = 40000.08 (≤1 centavo de deriva, esperado)
check("caja re-derivada 1666.67×24", precioPresentacion(1666.67, 24), 40000.08, 1e-9);
// Guardas: unidades inválidas o precio no positivo
check("unidades 0 → 0", precioPresentacion(100, 0), 0, 1e-9);
check("precio presentación 0 → 0", precioUnidadDesdePresentacion(2400, 0), 0, 1e-9);

const presProducto = {
  precio_base: 80000,
  costo_base: 64000,
  moneda_base_id: "3", // venta COP
  moneda_costo_id: "3", // costo COP
};
const presentacionesProd = [
  { id: "p1", nombre: "Caja de 24", unidades: 24, activo: true },
  { id: "p2", nombre: "Bolsa de 12", unidades: 12, activo: false },
];
const calc = presentacionesDeProducto(presProducto, presentacionesProd, 2);
const caja = calc.find((p) => p.id === "p1");
const bolsa = calc.find((p) => p.id === "p2");
check("caja: precio derivado 80000×24", caja?.precio ?? 0, 80000 * 24, 1e-9);
check("caja: costo derivado 64000×24", caja?.costo ?? 0, 64000 * 24, 1e-9);
check("bolsa: se incluye con activo=false", Number(bolsa?.activo ?? true), 0, 1e-9);
check("bolsa: precio derivado 80000×12", bolsa?.precio ?? 0, 80000 * 12, 1e-9);

console.log("\n── margenSobreCosto (margen real = markup sobre costo) ──");
check("costo 100 → precio 120 = 20 %", margenSobreCosto(120, 100) ?? NaN, 20, 1e-9);
check("costo 80000 → precio 100000 = 25 %", margenSobreCosto(100000, 80000) ?? NaN, 25, 1e-9);
check("redondeo a 2 decimales (1/3)", margenSobreCosto(133.333, 100) ?? NaN, 33.33, 1e-9);
checkTrue("costo 0 → null (sin margen)", margenSobreCosto(100, 0) === null);
checkTrue("precio 0 → null (sin margen)", margenSobreCosto(0, 100) === null);
checkTrue("negativos → null", margenSobreCosto(-5, 100) === null && margenSobreCosto(100, -5) === null);
// Coherencia con la convención de la app: precio = costo × (1 + margen/100)
check("ida y vuelta: costo 250, margen 40 %", margenSobreCosto(250 * 1.4, 250) ?? NaN, 40, 1e-9);

console.log("\n── descuentos por línea (2 encadenados) ──");
// Sin descuentos
{
  const d = aplicarDescuentosLinea(100, 2, 0, 0, 2);
  check("sin dcto: bruto 200", d.subtotalBruto, 200);
  check("sin dcto: neto = bruto", d.subtotalNeto, 200);
  check("sin dcto: descuento 0", d.descuentoTotalMonto, 0);
  check("sin dcto: costo unit neto 100", d.costoUnitNeto, 100);
}
// Solo 1er descuento: 100×2 = 200, −10% = 180
{
  const d = aplicarDescuentosLinea(100, 2, 10, 0, 2);
  check("d1=10: bruto 200", d.subtotalBruto, 200);
  check("d1=10: tras 1º = 180", d.subtotalTras1, 180);
  check("d1=10: neto = 180", d.subtotalNeto, 180);
  check("d1=10: monto dcto = 20", d.descuento1Monto, 20);
  check("d1=10: costo unit neto = 90", d.costoUnitNeto, 90);
}
// Encadenados: 200 −10% = 180, luego −50% sobre 180 = 90
{
  const d = aplicarDescuentosLinea(100, 2, 10, 50, 2);
  check("d1=10,d2=50: tras 1º = 180", d.subtotalTras1, 180);
  check("d1=10,d2=50: neto = 90", d.subtotalNeto, 90);
  check("d1=10,d2=50: d1 monto = 20", d.descuento1Monto, 20);
  check("d1=10,d2=50: d2 monto = 90 (sobre 180)", d.descuento2Monto, 90);
  check("d1=10,d2=50: total dcto = 110", d.descuentoTotalMonto, 110);
  check("d1=10,d2=50: costo unit neto = 45", d.costoUnitNeto, 45);
}
// Verificación clave: el 2º se aplica SOBRE el 1º, no sobre el bruto
{
  // Si fuera sobre el bruto: 200×0.9×0.5 = 90 igual... pero 200×0.5=100≠90
  const d = aplicarDescuentosLinea(100, 2, 10, 50, 2);
  checkTrue("2º descuento es encadenado (≠ 50% del bruto)", d.subtotalNeto !== aplicarDescuentosLinea(100, 2, 0, 50, 2).subtotalNeto);
}
// Encadenados con 20% y 25% sobre 1000
{
  const d = aplicarDescuentosLinea(1000, 1, 20, 25, 6);
  check("1000 −20% = 800", d.subtotalTras1, 800);
  check("800 −25% = 600", d.subtotalNeto, 600);
  check("costo unit neto 600", d.costoUnitNeto, 600);
}
// 100% de descuento → 0
{
  const d = aplicarDescuentosLinea(50, 4, 100, 0, 2);
  check("d1=100: neto = 0", d.subtotalNeto, 0);
  check("d1=100: monto = 200", d.descuentoTotalMonto, 200);
}
// Acotado a [0,100]: un 150% no genera negativo
{
  const d = aplicarDescuentosLinea(100, 1, 150, 0, 2);
  check("d1=150 se acota a 100 → neto 0", d.subtotalNeto, 0);
  checkTrue("nunca negativo", d.subtotalNeto >= 0);
}
// Negativo se trata como 0
{
  const d = aplicarDescuentosLinea(100, 1, -20, 0, 2);
  check("d1=-20 → sin descuento", d.subtotalNeto, 100);
}
// Cantidad 0 no divide por cero
{
  const d = aplicarDescuentosLinea(100, 0, 10, 10, 2);
  check("cantidad 0: bruto 0", d.subtotalBruto, 0);
  checkTrue("cantidad 0: sin NaN", Number.isFinite(d.costoUnitNeto));
}

console.log("\n── descuento general de la factura ──");
// Sin descuento general
{
  const r = calcularTotalConDescuentos([100, 200, 300], 0, 2);
  check("general 0: neto líneas 600", r.subtotalNetoLineas, 600);
  check("general 0: monto dcto 0", r.descuentoGeneralMonto, 0);
  check("general 0: total 600", r.total, 600);
}
// 10% general sobre el neto de líneas
{
  const r = calcularTotalConDescuentos([100, 200, 300], 10, 2);
  check("general 10: monto dcto 60", r.descuentoGeneralMonto, 60);
  check("general 10: total 540", r.total, 540);
}
// 100% general → 0
{
  const r = calcularTotalConDescuentos([100, 200], 100, 2);
  check("general 100: total 0", r.total, 0);
}
// Acotado: 150% → 100%
{
  const r = calcularTotalConDescuentos([100], 150, 2);
  check("general 150 se acota a 100 → total 0", r.total, 0);
}
// Cascada completa: líneas con descuentos + general
{
  // Línea 1: 100×2=200 −10% = 180   |  Línea 2: 50×4=200 −0%−50% = 100
  const l1 = aplicarDescuentosLinea(100, 2, 10, 0, 2);
  const l2 = aplicarDescuentosLinea(50, 4, 0, 50, 2);
  const r = calcularTotalConDescuentos([l1.subtotalNeto, l2.subtotalNeto], 10, 2);
  check("cascada: neto líneas 280", r.subtotalNetoLineas, 280);
  check("cascada: general 10% = 28", r.descuentoGeneralMonto, 28);
  check("cascada: total 252", r.total, 252);
}

// ============================================================================
// PRESENTACIONES CON PRECIO PROPIO — 3 modos
// ============================================================================
console.log("\n── precio de presentación según modo ──");

// Caso real: cigarro. Unidad a 250, CPP 200, caja x20.
// derivado → 250×20 = 5000 | fijo → 4500 | margen 15% → 200×20×1.15 = 4600
{
  const base = { unidades: 20, precioUnidad: 250, costoUnitario: 200, decimales: 2 };

  const der = precioPresentacionSegunModo({ ...base, modo: "derivado" });
  check("derivado: precio = unidad × 20 = 5000", der.precio, 5000);
  check("derivado: unitario = 250", der.precioUnitario, 250);
  check("derivado: costo = CPP × 20 = 4000", der.costo, 4000);
  check("derivado: margen = (5000−4000)/4000 = 25%", der.margen ?? NaN, 25);
  checkTrue("derivado: NO está más barata que el detalle", !der.masBarataQueDetalle);

  const fix = precioPresentacionSegunModo({ ...base, modo: "fijo", precioOverride: 4500 });
  check("fijo: precio = override = 4500", fix.precio, 4500);
  check("fijo: unitario = 4500/20 = 225", fix.precioUnitario, 225);
  check("fijo: margen = (4500−4000)/4000 = 12.5%", fix.margen ?? NaN, 12.5, 0.02);
  checkTrue("fijo: SÍ está más barata que el detalle", fix.masBarataQueDetalle);

  const mg = precioPresentacionSegunModo({ ...base, modo: "margen", margenOverride: 15 });
  check("margen: precio = costo×20×1.15 = 4600", mg.precio, 4600);
  check("margen: unitario = 230", mg.precioUnitario, 230);
  check("margen: margen = 15% (markup sobre costo)", mg.margen ?? NaN, 15);
  // Un precio mayorista DEBE ser más barato por unidad: eso no es un error.
  checkTrue("margen: la caja es más barata por unidad (informativo)", mg.masBarataQueDetalle);
}

// El modo `margen` se apoya en el COSTO: si sube el CPP, el precio sube solo.
{
  const antes = precioPresentacionSegunModo({ unidades: 20, precioUnidad: 250, costoUnitario: 200, modo: "margen", margenOverride: 15, decimales: 2 });
  const despues = precioPresentacionSegunModo({ unidades: 20, precioUnidad: 250, costoUnitario: 220, modo: "margen", margenOverride: 15, decimales: 2 });
  check("modo margen con CPP 200 → 4600", antes.precio, 4600);
  check("modo margen con CPP 220 → 5060", despues.precio, 5060);
  check("modo margen: el margen NO se erosiona (15%)", despues.margen ?? NaN, 15, 0.02);
}

// El modo `fijo` NO se mueve aunque el CPP cambie.
{
  const antes = precioPresentacionSegunModo({ unidades: 20, precioUnidad: 250, costoUnitario: 200, modo: "fijo", precioOverride: 4500, decimales: 2 });
  const despues = precioPresentacionSegunModo({ unidades: 20, precioUnidad: 250, costoUnitario: 260, modo: "fijo", precioOverride: 4500, decimales: 2 });
  check("modo fijo: precio intacto con CPP 200", antes.precio, 4500);
  check("modo fijo: precio intacto con CPP 260", despues.precio, 4500);
  check("modo fijo: el margen SE erosiona", despues.margen ?? NaN, (4500 - 5200) / 5200 * 100, 0.02);
  checkTrue("modo fijo: queda por debajo del costo", despues.bajoCosto);
}

// Modo desconocido o nulo → derivado (retrocompatible).
{
  const a = precioPresentacionSegunModo({ unidades: 10, precioUnidad: 100, costoUnitario: 60, modo: null, decimales: 2 });
  check("modo null → derivado", a.precio, 1000);
  const b = precioPresentacionSegunModo({ unidades: 10, precioUnidad: 100, costoUnitario: 60, modo: "inventado", decimales: 2 });
  check("modo desconocido → derivado", b.precio, 1000);
}

// `fijo` sin override → cae a derivado (no queda en 0).
{
  const a = precioPresentacionSegunModo({ unidades: 10, precioUnidad: 100, costoUnitario: 60, modo: "fijo", precioOverride: null, decimales: 2 });
  check("fijo sin override → deriva", a.precio, 1000);
}

// Venta con pérdida.
{
  const a = precioPresentacionSegunModo({ unidades: 20, precioUnidad: 250, costoUnitario: 200, modo: "fijo", precioOverride: 3000, decimales: 2 });
  checkTrue("precio bajo costo se detecta", a.bajoCosto);
  check("precio bajo costo = 3000", a.precio, 3000);
}

// El COSTO siempre se deriva del CPP, nunca del override.
{
  const a = precioPresentacionSegunModo({ unidades: 20, precioUnidad: 250, costoUnitario: 200, modo: "margen", margenOverride: 0, decimales: 2 });
  check("margen 0% → precio = costo = 4000", a.precio, 4000);
  check("margen 0% → margen 0", a.margen ?? NaN, 0);
}

// Guardas.
{
  const a = precioPresentacionSegunModo({ unidades: 1, precioUnidad: 250, costoUnitario: 200, modo: "derivado", decimales: 2 });
  check("unidades ≤ 1 → 0", a.precio, 0);
  const b = precioPresentacionSegunModo({ unidades: 20, precioUnidad: 0, costoUnitario: 0, modo: "margen", margenOverride: 15, decimales: 2 });
  check("sin costo ni precio → 0", b.precio, 0);
  checkTrue("sin costo → margen null", b.margen === null);
}

// presentacionesDeProducto: usa CPP si existe, si no el costo estático.
console.log("\n── presentacionesDeProducto: CPP manda sobre costo estático ──");
{
  const prod = { precio_base: 250, costo_base: 180, costo_promedio: 200 };
  const pres = [
    { id: 1, nombre: "Caja x20", unidades: 20, modo_venta: "derivado" },
    { id: 2, nombre: "Caja x20 mayorista", unidades: 20, modo_venta: "margen", margen_override: 15 },
  ];
  const r = presentacionesDeProducto(prod, pres, 2);
  check("derivado usa precio_base", r[0].precio, 5000);
  check("margen usa el CPP (200), no costo_base (180)", r[1].precio, 4600);
  check("costo derivado del CPP", r[1].costo, 4000);

  // Producto sin CPP todavía → cae al costo estático.
  const prodSinCpp = { precio_base: 250, costo_base: 180 };
  const r2 = presentacionesDeProducto(prodSinCpp, pres, 2);
  check("sin CPP usa costo_base", r2[1].precio, 180 * 20 * 1.15);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ida y vuelta: guardar → leer → volver a guardar
// Una presentación GUARDADA debe conservar su modo y su override cuando la
// API la devuelve. Si la API no devuelve `precio_override`, al reabrir el
// producto el modal cae a 'derivado' y el precio fijo se pierde en silencio.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── ida y vuelta de precio fijo / por margen ──");
{
  const prod = { precio_base: 200, costo_base: 0.05, costo_promedio: 0.0475 };
  const guardado = [
    { id: 1, nombre: "Caja", unidades: 20, activo: true, modo_venta: "fijo", precio_override: 3000, margen_override: null },
    { id: 2, nombre: "Caja may", unidades: 20, activo: true, modo_venta: "margen", precio_override: null, margen_override: 15 },
  ];

  // Lo que devuelve la API...
  const deApi = presentacionesDeProducto(prod, guardado, 2);
  // ...y lo que el modal se guarda en su formulario para reenviarlo.
  const reenviado = deApi.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    unidades: p.unidades,
    activo: p.activo,
    modo_venta: p.modo_venta,
    precio_override: (p as any).precio_override ?? null,
    margen_override: (p as any).margen_override ?? null,
  }));

  checkTrue("lectura: fijo conserva precio_override = 3000", reenviado[0].precio_override === 3000);
  checkTrue("lectura: margen conserva margen_override = 15", reenviado[1].margen_override === 15);
  checkTrue("lectura: el precio fijo se lee como 3000 (no 4000)", deApi[0].precio === 3000);

  // Reenviar eso NO debe degradar la presentación a 'derivado'.
  const trasReenvio = presentacionesDeProducto(prod, reenviado, 2);
  check("reenvío: el precio fijo sigue en 3000", trasReenvio[0].precio, 3000);
  check("reenvío: el modo sigue siendo 'fijo'", trasReenvio[0].modo_venta === "fijo" ? 1 : 0, 1);

  // Y si el override se pierde, el precio debe ser el derivado (4000) — que es
  // exactamente el síntoma que reportó el usuario.
  const sinOverride = reenviado.map((p) => ({ ...p, precio_override: null, margen_override: null }));
  check("control: reenvío sin override degrada a derivado (4000)", presentacionesDeProducto(prod, sinOverride, 2)[0].precio, 4000);
}

console.log(fallos === 0 ? "\n✅ TODAS LAS PRUEBAS PASARON" : `\n❌ ${fallos} FALLAS`);
process.exit(fallos === 0 ? 0 : 1);
