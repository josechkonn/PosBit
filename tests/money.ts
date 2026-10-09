// Pruebas numéricas de src/lib/money.ts (la fuente de verdad de las fórmulas).
// Correr con: npm run test:money   (Node ≥ 22.6 con strip-types, o ≥ 23)
import { tasaUsd, convertir, tasaUsdDocumento, aBase, desdeBase, redondear, tasaPar, preciosDeProducto } from "../src/lib/money.ts";

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

console.log(fallos === 0 ? "\n✅ TODAS LAS PRUEBAS PASARON" : `\n❌ ${fallos} FALLAS`);
process.exit(fallos === 0 ? 0 : 1);
