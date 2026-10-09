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
//
// ----------------------------------------------------------------------------
// CONVERSIÓN DIRECTA A USD (opcional, por moneda)
// ----------------------------------------------------------------------------
// Una moneda no-base puede marcar `usa_tasa_usd_directa` con su propio valor
// `tasa_usd_directa` (unidades de la moneda por 1 USD). En ese caso:
//
//   * El par moneda ↔ USD usa la tasa directa (no la cadena por referencias).
//   * El par moneda ↔ su referencia SIGUE usando `tasa` (p. ej. COP ↔ BS = 3.2).
//
// Ej.: COP con ref BS, `tasa` = 3.2 y `usa_tasa_usd_directa` con 3200:
//   COP → USD ÷ 3200 (directo)     USD → COP × 3200
//   COP → BS  ÷ 3.2                BS  → COP × 3.2
// ============================================================================

export interface MonedaConversion {
  id: string;
  codigo?: string | null;
  simbolo?: string | null;
  tasa: number | string;
  decimales?: number | null;
  es_base?: boolean | null;
  tasa_ref_moneda_id?: string | null;
  /** Modo directo: ignora la cadena y usa `tasa_usd_directa` para el par con USD. */
  usa_tasa_usd_directa?: boolean | null;
  /** Unidades de la moneda por 1 USD cuando el modo directo está activo. */
  tasa_usd_directa?: number | string | null;
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

/** Tasa directa a USD si el modo está activo y el valor es válido; si no, null. */
function tasaDirectaUsd(moneda: MonedaConversion | null | undefined): number | null {
  if (!moneda?.usa_tasa_usd_directa) return null;
  const tasa = Number(moneda.tasa_usd_directa);
  return Number.isFinite(tasa) && tasa > 0 ? tasa : null;
}

/** ¿La moneda convierte a USD con tasa directa (ignorando la cadena)? */
export function esConversionDirectaUsd(moneda: MonedaConversion | null | undefined): boolean {
  return tasaDirectaUsd(moneda) !== null;
}

/**
 * Tasa "de cara al usuario" por defecto de una moneda: la directa a USD si el
 * modo está activo, si no la de referencia (`tasa`). Sirve para placeholders.
 */
export function tasaMostrada(moneda: MonedaConversion | null | undefined): number {
  return tasaDirectaUsd(moneda) ?? tasaNumerica(moneda);
}

function referenciaId(moneda: MonedaConversion | null | undefined): string | null {
  const id = moneda?.tasa_ref_moneda_id;
  return id === null || id === undefined ? null : String(id);
}

/**
 * Unidades de `moneda` por 1 USD. Si la moneda tiene conversión directa
 * activa, usa `tasa_usd_directa`; si no, resuelve la cadena de referencias.
 * Defensivo contra ciclos (máx. 10 saltos) y contra tasas inválidas.
 */
export function tasaUsd(
  moneda: MonedaConversion | null | undefined,
  catalogo: MonedaConversion[] = []
): number {
  if (!moneda) return 1;

  const directa = tasaDirectaUsd(moneda);
  if (directa !== null) return directa;

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
 * Factor de conversión: unidades de `hasta` por 1 unidad de `desde`.
 * Misma regla que `convertir`: si una moneda referencia a la otra se usa su
 * `tasa` directa (COP ↔ BS = 3.2 aunque COP use tasa directa a USD); si no, se
 * pasa por USD con las tasas efectivas.
 *
 * `efectivas` (opcional) permite sobreescribir la tasa USD de una moneda (por
 * id) con la efectiva del documento (tasa personalizada). Con eso la arista
 * directa COP ↔ BS sigue siendo 3.2 en modo directo, pero en modo cadena el
 * par usa la tasa personalizada contra la referencia (igual que siempre).
 */
export function tasaPar(
  desde: MonedaConversion | null | undefined,
  hasta: MonedaConversion | null | undefined,
  catalogo: MonedaConversion[] = [],
  efectivas?: Record<string, number> | null
): number {
  if (!desde || !hasta) return 1;
  if (String(desde.id) === String(hasta.id)) return 1;

  const efectivaDe = (m: MonedaConversion): number => {
    const ef = efectivas?.[String(m.id)];
    return typeof ef === "number" && Number.isFinite(ef) && ef > 0 ? ef : tasaUsd(m, catalogo);
  };

  // Arista directa entre una moneda y su referencia.
  const refDesde = referenciaId(desde);
  if (refDesde !== null && refDesde === String(hasta.id)) {
    // 1 `hasta` = X `desde` → factor = 1/X
    // En modo directo la personalizada es por USD y NO toca el par con la referencia.
    const x = tasaDirectaUsd(desde) !== null ? tasaNumerica(desde) : efectivaDe(desde) / tasaUsd(hasta, catalogo);
    return x > 0 ? 1 / x : 1;
  }
  const refHasta = referenciaId(hasta);
  if (refHasta !== null && refHasta === String(desde.id)) {
    const x = tasaDirectaUsd(hasta) !== null ? tasaNumerica(hasta) : efectivaDe(hasta) / tasaUsd(desde, catalogo);
    return x > 0 ? x : 1;
  }

  const tasaDesde = efectivaDe(desde);
  if (tasaDesde <= 0) return 1;
  return efectivaDe(hasta) / tasaDesde;
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
  return redondear(monto * tasaPar(desde, hasta, catalogo), decimales);
}

/**
 * Tasa efectiva (unidades de la moneda por 1 USD) de un documento de
 * venta/compra: si trae tasa personalizada la usa en lugar de la de la
 * moneda; si no, la por defecto.
 *
 * En modo directo la tasa personalizada se interpreta como unidades de la
 * moneda por 1 USD (p. ej. COP por USD). En modo cadena se interpreta contra
 * la referencia de la moneda (p. ej. COP por BS), igual que antes.
 */
export function tasaUsdDocumento(
  moneda: MonedaConversion | null | undefined,
  tasaPersonalizada: number | string | null | undefined,
  catalogo: MonedaConversion[] = []
): number {
  const custom = tasaPersonalizada === null || tasaPersonalizada === undefined ? NaN : Number(tasaPersonalizada);
  if (!Number.isFinite(custom) || custom <= 0) return tasaUsd(moneda, catalogo);

  // Modo directo: la tasa personalizada ya está expresada en unidades por USD.
  if (tasaDirectaUsd(moneda) !== null) return custom;

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
