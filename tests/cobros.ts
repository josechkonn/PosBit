// Pruebas de la regla de conversión de los COBROS EXTRA del POS.
// Replica `montoCobroEnMoneda` + `rebasarCobrosExtra` tal como quedaron en
// src/app/(app)/pos/page.tsx, para comprobar que el monto de un cobro:
//   · se comporta como el precio de un producto al cambiar de moneda, y
//   · NO acumula centavos al ir y volver (el ancla es el valor sin redondear).
// Correr con: npm run test:cobros   (Node ≥ 22.6 con strip-types, o ≥ 23)
import { tasaUsdDocumento, tasaPar, redondear } from "../src/lib/money.ts";

// Catálogo con las mismas características que usa la app: COP referenciada a VES
// y con tasa directa a USD activa (por eso el par COP↔VES usa la arista directa 3.0).
const monedas: any[] = [
  { id: "u", codigo: "USD", simbolo: "$", tasa: 1, decimales: 4, es_base: true, tasa_ref_moneda_id: null },
  {
    id: "v", codigo: "VES", simbolo: "Bs", tasa: 892.2342, decimales: 2, es_base: false,
    tasa_ref_moneda_id: null, usa_tasa_usd_directa: false, tasa_usd_directa: null,
  },
  {
    id: "c", codigo: "COP", simbolo: "$", tasa: 3, decimales: 2, es_base: false,
    tasa_ref_moneda_id: "v", usa_tasa_usd_directa: true, tasa_usd_directa: 2900,
  },
];

const decMoneda = (cod: string) => Number(monedas.find((m) => m.codigo === cod)?.decimales ?? 2);

interface CobroExtra {
  key: number;
  concepto: string;
  montoStr: string;
  montoAncla: number;
  monedaAncla: string;
}

// ── copia exacta de la implementación del POS ──
function montoCobroEnMoneda(c: CobroExtra, codMoneda: string, tasaCustom = NaN): number {
  const destino = codMoneda || c.monedaAncla;
  if (!c.montoAncla || c.montoAncla <= 0) return 0;
  if (!destino || destino === c.monedaAncla) return redondear(c.montoAncla, decMoneda(destino));

  const desde = monedas.find((m) => m.codigo === c.monedaAncla);
  const hasta = monedas.find((m) => m.codigo === destino);
  if (!desde || !hasta) return redondear(c.montoAncla, decMoneda(destino));

  const tasaCustomNum = Number.isFinite(tasaCustom) && tasaCustom > 0 ? tasaCustom : null;
  const tasaHasta = tasaUsdDocumento(hasta, tasaCustomNum, monedas);
  const factor = tasaPar(desde, hasta, monedas, { [String(hasta.id)]: tasaHasta });
  return redondear(c.montoAncla * factor, decMoneda(destino));
}

function rebasarCobrosExtra(cobros: CobroExtra[], codDestino: string): CobroExtra[] {
  if (!codDestino) return cobros;
  return cobros.map((c) =>
    c.montoAncla > 0 ? { ...c, montoStr: String(montoCobroEnMoneda(c, codDestino, 0)) } : c
  );
}

function editarMonto(c: CobroExtra, montoStr: string, monedaActual: string): CobroExtra {
  const num = parseFloat(montoStr.trim().replace(",", "."));
  const montoAncla = Number.isFinite(num) && num > 0 ? num : 0;
  return { ...c, montoStr, montoAncla, monedaAncla: monedaActual };
}

let fallos = 0;
function check(nombre: string, real: number, esperado: number, tol = 0.01) {
  const ok = Math.abs(real - esperado) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FAIL"} ${nombre}: real=${real} esperado=${esperado}`);
}
function checkTrue(nombre: string, cond: boolean, extra = "") {
  if (!cond) fallos++;
  console.log(`${cond ? "OK  " : "FAIL"} ${nombre}${extra ? " :: " + extra : ""}`);
}

// ── Casos ──
const c = (montoAncla: number, monedaAncla: string): CobroExtra => ({
  key: 1, concepto: "Delivery", montoStr: String(montoAncla), montoAncla, monedaAncla,
});

check("monto en su propia moneda no se toca", montoCobroEnMoneda(c(5, "USD"), "USD"), 5);
check("USD → VES con tasa por defecto", montoCobroEnMoneda(c(5, "USD"), "VES"), 4461.17, 0.02);
check("VES → USD (vuelta)", montoCobroEnMoneda(c(4461.17, "VES"), "USD"), 5, 0.02);
// COP tiene tasa directa a USD (2900), así que USD→COP usa esa tasa, mientras
// COP↔VES usa la arista directa de referencia (3.0). Ver el bug reportado.
check("USD → COP usa la tasa directa a USD (×2900)", montoCobroEnMoneda(c(5, "USD"), "COP"), 14500);
check("COP → VES usa la arista directa (÷3)", montoCobroEnMoneda(c(2000, "COP"), "VES"), 666.67, 0.001);
check("ancla 0 = cobro vacío", montoCobroEnMoneda(c(0, "USD"), "VES"), 0);
check("respeta los 4 decimales de USD", redondear(montoCobroEnMoneda(c(5.1234, "USD"), "USD"), 4), 5.1234, 0.0001);
check("al convertir a VES redondea a sus 2 decimales", redondear(montoCobroEnMoneda(c(5.1234, "USD"), "VES"), 2), 4571.27, 0.02);
check("respeta tasa personalizada (USD→VES 900)", montoCobroEnMoneda(c(5, "USD"), "VES", 900), 4500);

// ── Regresión del bug reportado: 2000 COP → VES → COP ──
// El rebase solo reescribe lo MOSTRADO; el ancla sigue siendo 2000 COP, así que
// volver no puede dar 2000.01 (lo que salía de reconvertir 666.67 × 3).
{
  const original = c(2000, "COP");
  const aVes = rebasarCobrosExtra([original], "VES")[0];
  check("2000 COP se muestra en VES", Number(aVes.montoStr), 666.67, 0.001);

  const deVuelta = rebasarCobrosExtra([aVes], "COP")[0];
  check("vuelve a 2000 COP exactos (no 2000.01)", Number(deVuelta.montoStr), 2000, 0);
  checkTrue("ancla intacta tras ir y volver", deVuelta.monedaAncla === "COP" && deVuelta.montoAncla === 2000,
    `monedaAncla=${deVuelta.monedaAncla} montoAncla=${deVuelta.montoAncla}`);

  // Varias idas y vueltas: tampoco debe acumular
  let lista = [original];
  for (let i = 0; i < 6; i++) lista = rebasarCobrosExtra(lista, "VES");
  for (let i = 0; i < 6; i++) lista = rebasarCobrosExtra(lista, "COP");
  check("12 conversiones de ida y vuelta: sigue en 2000", Number(lista[0].montoStr), 2000, 0);
}

// Editar el monto a propósito SÍ mueve el ancla (el usuario manda)
{
  const enVes = rebasarCobrosExtra([c(2000, "COP")], "VES")[0];
  const editado = editarMonto(enVes, "800", "VES");
  check("monto editado: 800 VES", Number(editarMonto(enVes, "800", "VES").montoStr), 800, 0);
  checkTrue("editar mueve el ancla a la moneda editada", editado.monedaAncla === "VES" && editado.montoAncla === 800);
  check("el total usa el monto editado", Number(montoCobroEnMoneda(editado, "VES")), 800, 0);
  check("y al volver a COP da 2400", Number(montoCobroEnMoneda(editado, "COP")), 2400, 0.001);
}

// Varios cobros: la suma tras el rebase se recalcula desde cada ancla
{
  const dos = rebasarCobrosExtra([c(5, "USD"), { ...c(1.5, "USD"), key: 2, concepto: "Propina" }], "VES");
  const suma = redondear(dos.reduce((s, x) => s + montoCobroEnMoneda(x, "VES"), 0), 2);
  check("suma de varios cobros tras rebase", suma, 5799.52, 0.02);
}

// Un cobro vacío no debe romperse al rebasear
{
  const vacio = rebasarCobrosExtra([{ key: 1, concepto: "", montoStr: "", montoAncla: 0, monedaAncla: "USD" }], "VES")[0];
  checkTrue("cobro vacío sobrevive al rebase", vacio.montoStr === "" && vacio.montoAncla === 0, vacio.montoStr);
}

console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
