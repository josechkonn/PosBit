// ============================================================================
// POSBIT - Regla única de conversión de monedas (server + client)
// ----------------------------------------------------------------------------
// `monedas.tasa` = cuántas unidades de la moneda equivalen a 1 unidad de SU
// MONEDA DE REFERENCIA (`tasa_ref_moneda_id`; NULL = USD, la moneda base).
//
//   USD: tasa 1.000000   ref NULL          → tasaUsd = 1
//   BS : tasa 892.2342   ref NULL          → tasaUsd = 892.2342
//   COP: tasa 3.2        ref BS            → tasaUsd = 3.2 × 892.2342 = 2855.14944
//
// Con eso cualquier par se convierte con la MISMA regla:
//
//   convertir(monto, A, B) = monto ÷ tasaUsd(A) × tasaUsd(B)
//
//   USD → BS  × 892.2342        BS  → USD ÷ 892.2342
//   USD → COP × 2855.14944      COP → USD ÷ 2855.14944
//   BS  → COP × 3.2             COP → BS  ÷ 3.2
// ============================================================================

export interface MonedaConversion {
  id: string;
  codigo?: string | null;
  simbolo?: string | null;
  tasa: number | string;
  decimales?: number | null;
  es_base?: boolean | null;
  tasa_ref_moneda_id?: string | null;
}

/** Redondeo centralizado (antes había Math.round(x*100)/100 repartido en ~20 archivos). */
export function redondear(valor: number, decimales = 2): number {
  if (!Number.isFinite(valor)) return 0;
  const factor = Math.pow(10, decimales);
  return Math.round((valor + Number.EPSILON) * factor) / factor;
}

function tasaNumerica(moneda: MonedaConversion | null | undefined): number {
  const tasa = Number(moneda?.tasa);
  return Number.isFinite(tasa) && tasa > 0 ? tasa : 1;
}

/**
 * Unidades de `moneda` por 1 USD, resolviendo la cadena de referencias.
 * Defensivo contra ciclos (máx. 10 saltos) y contra tasas inválidas.
 */
export function tasaUsd(
  moneda: MonedaConversion | null | undefined,
  catalogo: MonedaConversion[] = []
): number {
  if (!moneda) return 1;

  let tasa = tasaNumerica(moneda);
  // Los ids de moneda son UUID: se comparan como cadena. Usar Number() aquí
  // devolvería NaN y cortaría prematuramente la cadena de referencias.
  const vistos = new Set<string>([String(moneda.id)]);
  let refId = moneda.tasa_ref_moneda_id ?? null;
  let saltos = 0;

  while (refId !== null && refId !== undefined && saltos++ < 10) {
    const refClave = String(refId);
    if (vistos.has(refClave)) break; // ciclo: cortamos
    vistos.add(refClave);
    const ref = catalogo.find((m) => String(m.id) === refClave);
    if (!ref) break;
    tasa *= tasaNumerica(ref);
    refId = ref.tasa_ref_moneda_id ?? null;
  }

  return tasa;
}

/**
 * Convierte un monto de una moneda a otra.
 * `decimales` por defecto 2; pasar los de la moneda destino cuando se conozcan.
 */
export function convertir(
  monto: number,
  desde: MonedaConversion | null | undefined,
  hasta: MonedaConversion | null | undefined,
  catalogo: MonedaConversion[] = [],
  decimales = 2
): number {
  if (!Number.isFinite(monto)) return 0;
  const tasaDesde = tasaUsd(desde, catalogo);
  if (tasaDesde <= 0) return redondear(monto, decimales);
  return redondear((monto / tasaDesde) * tasaUsd(hasta, catalogo), decimales);
}

/**
 * Tasa efectiva (unidades de la moneda por 1 USD) de un documento de
 * venta/compra: si trae tasa personalizada la usa en lugar de la de la
 * moneda; si no, la por defecto.
 */
export function tasaUsdDocumento(
  moneda: MonedaConversion | null | undefined,
  tasaPersonalizada: number | string | null | undefined,
  catalogo: MonedaConversion[] = []
): number {
  const custom = tasaPersonalizada === null || tasaPersonalizada === undefined ? NaN : Number(tasaPersonalizada);
  if (!Number.isFinite(custom) || custom <= 0) return tasaUsd(moneda, catalogo);

  const refId = moneda?.tasa_ref_moneda_id ?? null;
  if (refId === null || refId === undefined) return custom; // vs USD (o moneda base)

  const ref = catalogo.find((m) => String(m.id) === String(refId));
  return custom * (ref ? tasaUsd(ref, catalogo) : 1);
}

/** Monto en la moneda del documento → USD (columnas `*_base`). */
export function aBase(monto: number, tasaDocUsd: number, decimales = 2): number {
  if (!Number.isFinite(monto) || !Number.isFinite(tasaDocUsd) || tasaDocUsd <= 0) {
    return redondear(monto, decimales);
  }
  return redondear(monto / tasaDocUsd, decimales);
}

/** Monto en USD (columnas `*_base`) → moneda del documento. */
export function desdeBase(montoBase: number, tasaDocUsd: number, decimales = 2): number {
  if (!Number.isFinite(montoBase) || !Number.isFinite(tasaDocUsd) || tasaDocUsd <= 0) {
    return redondear(montoBase, decimales);
  }
  return redondear(montoBase * tasaDocUsd, decimales);
}

/**
 * Moneda propia de un producto (`productos.moneda_base_id`).
 * Si no tiene, se usa `porDefecto` (la moneda de la venta/compra en curso).
 */
export function monedaDeProducto<T extends MonedaConversion>(
  producto: { moneda_base_id?: string | null } | null | undefined,
  porDefecto: T,
  catalogo: T[]
): T {
  const id = producto?.moneda_base_id;
  if (!id) return porDefecto;
  const encontrada = catalogo.find((m) => String(m.id) === String(id));
  return (encontrada as T) || porDefecto;
}
