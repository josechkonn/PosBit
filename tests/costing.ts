// Pruebas numéricas de src/lib/costing.ts (CPP, redondeo global y conversión
// Directa vs Triangulación). Correr con: npm run test:costing
import {
  calcularCpp,
  precioVentaDesdeCosto,
  aplicarReglasRedondeo,
  contextoCotizacion,
  convertirConMetodo,
  costoEstaticoEnBase,
} from "../src/lib/costing.ts";

const catalogo: any[] = [
  { id: 1, codigo: "USD", simbolo: "$", tasa: 1, decimales: 2, es_base: true, tasa_ref_moneda_id: null },
  { id: 2, codigo: "VES", simbolo: "Bs", tasa: 500, decimales: 2, es_base: false, tasa_ref_moneda_id: null },
  { id: 3, codigo: "COP", simbolo: "$", tasa: 3.2, decimales: 2, es_base: false, tasa_ref_moneda_id: 2 },
];
const [USD, VES, COP] = catalogo;

// Configuración global mínima (el motor la lee de configuracion_global).
const cfgBase: any = {
  metodo_conversion_compras: "directa",
  metodo_conversion_ventas: "directa",
  moneda_transito_compras_id: null,
  moneda_transito_ventas_id: null,
  auto_precio_compra: true,
  redondeo_activo: false,
  redondeo_multiplo: 0,
  redondeo_no_bajar_de_costo: true,
};

let fallos = 0;
function check(nombre: string, real: number | boolean, esperado: number | boolean, tol = 0.01) {
  const ok = Math.abs(Number(real) - Number(esperado)) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FAIL"} ${nombre}: real=${real} esperado=${esperado}`);
}

console.log("── CPP: Costo Promedio Ponderado (moneda base) ──");
check("primera entrada = costo entrante", calcularCpp({ cppActualBase: 0, stockActual: 0, costoUnitarioEntranteBase: 4, cantidadEntrante: 10 }), 4);
check("stock 0 y CPP legacy se descarta", calcularCpp({ cppActualBase: 9, stockActual: 0, costoUnitarioEntranteBase: 4, cantidadEntrante: 10 }), 4);
check(
  "ponderado (10u@4 + 10u@6 = 50/20 = 2.5)",
  calcularCpp({ cppActualBase: 4, stockActual: 10, costoUnitarioEntranteBase: 1, cantidadEntrante: 10 }),
  2.5
);
check("0 cantidad no altera", calcularCpp({ cppActualBase: 4, stockActual: 10, costoUnitarioEntranteBase: 99, cantidadEntrante: 0 }), 4);

console.log("── Precio de venta desde costo (margen) ──");
check("margen 25% => costo×1.25", precioVentaDesdeCosto(8, 25), 10);
check("margen 0 => costo", precioVentaDesdeCosto(8, 0), 8);
check("margen negativo => tratado como 0", precioVentaDesdeCosto(8, -10), 8);
check("margen inválido (NaN) => 0", precioVentaDesdeCosto(8, NaN), 8);

console.log("── Redondeo global ──");
check("inactivo: sin cambios", aplicarReglasRedondeo(7.33, { redondeo_activo: false, redondeo_multiplo: 0.5, redondeo_no_bajar_de_costo: true }, 0).precio, 7.33);
check("multiplo 0.5: 7.33 → 7.5", aplicarReglasRedondeo(7.33, { redondeo_activo: true, redondeo_multiplo: 0.5, redondeo_no_bajar_de_costo: true }, 0).precio, 7.5);
check("multiplo 1: 12.4 → 12", aplicarReglasRedondeo(12.4, { redondeo_activo: true, redondeo_multiplo: 1, redondeo_no_bajar_de_costo: true }, 0).precio, 12);
check("redondeado = true al cambiar", aplicarReglasRedondeo(12.4, { redondeo_activo: true, redondeo_multiplo: 1, redondeo_no_bajar_de_costo: true }, 0).redondeado, true);
check(
  "no bajar del costo: 7.33 redondeado a 7.0 < costo 7.1 → se fija en 7.1",
  aplicarReglasRedondeo(7.33, { redondeo_activo: true, redondeo_multiplo: 1, redondeo_no_bajar_de_costo: true }, 7.1).precio,
  7.1
);

console.log("── Conversión Directa ──");
const ctxDirecta = contextoCotizacion(cfgBase, "compras", catalogo);
check("VES 500 → USD ≈ 1", convertirConMetodo(500, VES, USD, ctxDirecta, 6), 1, 1e-6);
check("USD 1 → VES ≈ 500", convertirConMetodo(1, USD, VES, ctxDirecta, 2), 500, 1e-6);

console.log("── Conversión Triangulación (VES → COP → USD) ──");
const cfgTri: any = { ...cfgBase, metodo_conversion_compras: "triangulacion", moneda_transito_compras_id: COP.id };
const ctxTri = contextoCotizacion(cfgTri, "compras", catalogo);
((esTr: string) => {
  const ok = esTr === "COP";
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FAIL"} tránsito detectado en contexto: real=${esTr}`);
})(ctxTri.monedaTransito?.codigo ?? "ninguno");
// 500 VES → COP (1 COP = 3.2 VES → 156.25 COP) → USD (156.25 COP = 1 USD)
check("VES 500 → COP → USD ≈ 1", convertirConMetodo(500, VES, USD, ctxTri, 6), 1, 1e-6);

console.log("── Triangulación sin tránsito configurado → cae a directa ──");
const cfgSinTransito: any = { ...cfgBase, metodo_conversion_compras: "triangulacion", moneda_transito_compras_id: null };
const ctxSin = contextoCotizacion(cfgSinTransito, "compras", catalogo);
check("sin tránsito no bloquea: usa directa", convertirConMetodo(500, VES, USD, ctxSin, 6), 1, 1e-6);

console.log("── costoEstaticoEnBase (legacy) ──");
check("costo_base 2000 VES → USD = 4", costoEstaticoEnBase({ costo_base: 2000 }, VES, catalogo), 4, 1e-6);
check("sin costo → 0", costoEstaticoEnBase({ costo_base: 0 }, VES, catalogo), 0);

if (fallos > 0) {
  console.log(`\n${fallos} prueba(s) FALLARON`);
  process.exit(1);
}
console.log("\nTodas las pruebas pasaron ✔");