// Pruebas numéricas de src/lib/money.ts (la fuente de verdad de las fórmulas).
// Correr con: npm run test:money   (Node ≥ 22.6 con strip-types, o ≥ 23)
import { tasaUsd, convertir, tasaUsdDocumento, aBase, desdeBase, redondear, tasaPar } from "../src/lib/money.ts";

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

console.log(fallos === 0 ? "\n✅ TODAS LAS PRUEBAS PASARON" : `\n❌ ${fallos} FALLAS`);
process.exit(fallos === 0 ? 0 : 1);
