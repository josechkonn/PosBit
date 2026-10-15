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

/**
 * Margen (markup) sobre costo, en %: `(precio / costo - 1) × 100`. Devuelve
 * `null` si el precio o el costo no son positivos (no hay margen calculable).
 * Coincide con la semántica de `margen_ganancia` (`precio = costo × (1 + margen/100)`).
 */
export function margenSobreCosto(precio: number, costo: number, decimales = 2): number | null {
  const p = Number(precio);
  const c = Number(costo);
  if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0 || c <= 0) return null;
  return redondear((p / c - 1) * 100, decimales);
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

/** Método de conversión configurable globalmente (regla Set & Forget). */
export type MetodoConversionPrecio = "directa" | "triangulacion";

/**
 * Convierte `monto` de `desde` a `hasta` respetando el método global:
 *   directa       → par directo (regla `tasaPar`).
 *   triangulacion → dos saltos explícitos: desde → tránsito → hasta.
 * Si se pide triangulación sin moneda de tránsito configurada, cae a directa
 * (decisión a prueba de errores: nunca bloquea la operación).
 *
 * `efectivas` propaga la tasa personalizada del documento por id de moneda.
 * Vive aquí (no en `costing.ts`) para compartir EXACTA la misma regla con el
 * cliente — p. ej. el "PV estimado" del formulario de compras.
 */
export function convertirConMetodo(
  monto: number,
  desde: MonedaConversion | null | undefined,
  hasta: MonedaConversion | null | undefined,
  opts: {
    metodo?: MetodoConversionPrecio;
    monedaTransito?: MonedaConversion | null;
    catalogo?: MonedaConversion[];
    efectivas?: Record<string, number> | null;
  } = {},
  decimales = 2
): number {
  const { metodo = "directa", monedaTransito = null, catalogo = [], efectivas = null } = opts;
  if (!Number.isFinite(monto) || !desde || !hasta) return 0;
  if (metodo === "triangulacion" && monedaTransito) {
    const decTransito = Number((monedaTransito as { decimales?: number | null }).decimales ?? 2);
    const paso = redondear(monto * tasaPar(desde, monedaTransito, catalogo, efectivas), decTransito);
    return redondear(paso * tasaPar(monedaTransito, hasta, catalogo, efectivas), decimales);
  }
  return redondear(monto * tasaPar(desde, hasta, catalogo, efectivas), decimales);
}

// ============================================================================
// REGLAS DEL MOTOR (Set & Forget) → `convertirConMetodo`
// ----------------------------------------------------------------------------
// La configuración global define un método por lado: COMPRAS para costos y
// VENTAS para precios. `reglasConversion` traduce la fila de
// `configuracion_global` + el catálogo a las dos reglas, y es PURA/client-safe:
// el cliente (modal de producto, form. de compras) y el servidor (APIs) deben
// compartir EXACTAMENTE la misma regla, o una conversión se vería distinta
// entre "lo que el usuario ve" y "lo que se guarda".
// ============================================================================

/** Regla de un lado del motor: método + moneda de tránsito resuelta. */
export interface ReglaConversion {
  metodo: MetodoConversionPrecio;
  monedaTransito: MonedaConversion | null;
}

/** Reglas completas del motor, listas para `convertirConMetodo`. */
export interface ReglasConversionGlobal {
  compras: ReglaConversion;
  ventas: ReglaConversion;
}

/**
 * Traduce la fila de `configuracion_global` (o un fragmento) a las reglas del
 * motor usando el catálogo de monedas. Método desconocido/ausente → "directa"
 * (comportamiento histórico); sin tránsito configurado → null.
 */
export function reglasConversion(
  cfg:
    | {
        metodo_conversion_compras?: string | null;
        metodo_conversion_ventas?: string | null;
        moneda_transito_compras_id?: string | null;
        moneda_transito_ventas_id?: string | null;
      }
    | null
    | undefined,
  catalogo: MonedaConversion[]
): ReglasConversionGlobal {
  const metodo = (v?: string | null): MetodoConversionPrecio =>
    v === "triangulacion" ? "triangulacion" : "directa";
  const transito = (id?: string | null): MonedaConversion | null =>
    id ? catalogo.find((m) => String(m.id) === String(id)) ?? null : null;
  return {
    compras: {
      metodo: metodo(cfg?.metodo_conversion_compras),
      monedaTransito: transito(cfg?.moneda_transito_compras_id),
    },
    ventas: {
      metodo: metodo(cfg?.metodo_conversion_ventas),
      monedaTransito: transito(cfg?.moneda_transito_ventas_id),
    },
  };
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
 * Moneda propia de un producto (`productos.moneda_base_id`), usada para su
 * PRECIO DE VENTA (`precio_base`). Si no tiene, se usa `porDefecto` (la moneda
 * de la venta/compra en curso).
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

/**
 * Moneda del COSTO DE COMPRA de un producto (`productos.moneda_costo_id`),
 * usada para `costo_base`. Puede diferir de la moneda de venta (p. ej. costo en
 * USD, precio de venta en COP). Sin moneda propia = misma que la de venta.
 */
export function monedaCostoDeProducto<T extends MonedaConversion>(
  producto: {
    moneda_costo_id?: string | null;
    moneda_base_id?: string | null;
  } | null | undefined,
  porDefecto: T,
  catalogo: T[]
): T {
  const id = producto?.moneda_costo_id ?? producto?.moneda_base_id;
  if (!id) return porDefecto;
  const encontrada = catalogo.find((m) => String(m.id) === String(id));
  return (encontrada as T) || porDefecto;
}

/** Fila de precio calculado por moneda (lo que devuelven las APIs de productos). */
export interface PrecioPorMonedaCalculado {
  moneda_id: string;
  moneda_codigo: string | null;
  moneda_simbolo: string | null;
  tasa: number | string;
  usa_tasa_usd_directa?: boolean | null;
  tasa_usd_directa?: number | string | null;
  precio: number;
  costo: number;
  es_base: boolean;
}

/**
 * Precios por moneda de un producto, derivados SIEMPRE de los valores base.
 * `precio_base` está en la moneda de VENTA (`moneda_base_id`) y `costo_base` en
 * la de COMPRA (`moneda_costo_id`, NULL = misma que la de venta); cada uno se
 * convierte a cada moneda con las tasas ACTUALES (dinámicas). Así un cambio de
 * conversión (p. ej. activar COP↔USD directa) se refleja en todos los precios
 * sin tener que reescribir la base de datos.
 *
 * `reglas` (opcional) hace que las conversiones respeten el método del motor:
 * el COSTO se convierte con la regla de COMPRAS y el PRECIO con la de VENTAS.
 * Sin `reglas` se comporta como siempre (directo), así que es retrocompatible.
 */
export function preciosDeProducto<T extends MonedaConversion>(
  producto: {
    precio_base?: number | string | null;
    costo_base?: number | string | null;
    moneda_base_id?: string | null;
    moneda_costo_id?: string | null;
  } | null | undefined,
  catalogo: T[],
  baseSistema?: T | null,
  reglas?: ReglasConversionGlobal
): PrecioPorMonedaCalculado[] {
  const baseSistemaEf = baseSistema ?? catalogo.find((m) => m.es_base) ?? catalogo[0];
  if (!baseSistemaEf) return [];
  const monedaVenta = monedaDeProducto(producto, baseSistemaEf, catalogo);
  const monedaCosto = monedaCostoDeProducto(producto, baseSistemaEf, catalogo);
  const precioBaseN = Number(producto?.precio_base);
  const costoBaseN = Number(producto?.costo_base);
  const precioBase = Number.isFinite(precioBaseN) ? precioBaseN : 0;
  const costoBase = Number.isFinite(costoBaseN) ? costoBaseN : 0;

  return catalogo
    .map((mo) => {
      const esVenta = String(mo.id) === String(monedaVenta.id);
      const esCosto = String(mo.id) === String(monedaCosto.id);
      const dec = Number(mo.decimales ?? 2);
      return {
        moneda_id: String(mo.id),
        moneda_codigo: mo.codigo ?? null,
        moneda_simbolo: mo.simbolo ?? null,
        tasa: mo.tasa,
        usa_tasa_usd_directa: mo.usa_tasa_usd_directa ?? false,
        tasa_usd_directa: mo.tasa_usd_directa ?? null,
        // `es_base` marca la fila de la moneda de VENTA (la "de referencia" del
        // producto); el costo puede tener su propia moneda exacta aparte.
        es_base: esVenta,
        precio: esVenta
          ? precioBase
          : convertirConMetodo(precioBase, monedaVenta, mo, {
              metodo: reglas?.ventas?.metodo,
              monedaTransito: reglas?.ventas?.monedaTransito ?? null,
              catalogo,
            }, dec),
        costo: esCosto
          ? costoBase
          : convertirConMetodo(costoBase, monedaCosto, mo, {
              metodo: reglas?.compras?.metodo,
              monedaTransito: reglas?.compras?.monedaTransito ?? null,
              catalogo,
            }, dec),
      };
    })
    .sort(
      (a, b) =>
        Number(b.es_base) - Number(a.es_base) ||
        String(a.moneda_codigo ?? "").localeCompare(String(b.moneda_codigo ?? "")) ||
        String(a.moneda_id).localeCompare(String(b.moneda_id))
    );
}

// ============================================================================
// PRESENTACIONES DE PRODUCTO (Caja, Bolsa, Paquete...)
// ----------------------------------------------------------------------------
// La unidad base del sistema es SIEMPRE la "Unidad": el stock, kardex y costos
// internos pivotan en unidades. Una presentación es una capa de entrada/salida
// con un factor `unidades` (1 Caja = N unidades).
//
// Regla de consistencia: el PRECIO de presentación se deriva en LECTURA del
// precio unitario (precio_unidad × unidades). En los formularios ambos campos
// son editables y se recalculan en vivo en ambas direcciones; al persistir, la
// fuente de verdad es el precio unitario.
// ============================================================================

/** Precio de la presentación = precio unitario × unidades (redondeado). */
export function precioPresentacion(precioUnidad: number, unidades: number, decimales = 2): number {
  const p = Number(precioUnidad);
  const u = Number(unidades);
  if (!Number.isFinite(p) || !Number.isFinite(u) || u <= 0 || p < 0) return 0;
  return redondear(p * u, decimales);
}

/** Precio unitario despejado desde el precio de la presentación = precio / unidades. */
export function precioUnidadDesdePresentacion(precioPresentacion: number, unidades: number, decimales = 2): number {
  const p = Number(precioPresentacion);
  const u = Number(unidades);
  if (!Number.isFinite(p) || !Number.isFinite(u) || u <= 0 || p <= 0) return 0;
  return redondear(p / u, decimales);
}

// ============================================================================
// DESCUENTOS (compras y, por simetría, ventas)
// ----------------------------------------------------------------------------
// Dos descuentos POR LÍNEA encadenados: el 2º se aplica sobre el resultado del 1º
// ("descuento sobre descuento"), que es como lo pide el operador cuando negocia
// un precio de lista y después aplica un descuento comercial extra. Encima, un
// descuento GENERAL de la factura aplicado al total ya descontado.
//
// Todo en funciones PURAS y sin redondeos prematuros: se redondea solo el
// resultado final de cada línea y del total, para no acumular error flotante.
// ============================================================================

export interface DescontosLinea {
  /** Subtotal de lista: costo unitario × cantidad (sin descuentos). */
  subtotalBruto: number;
  /** Subtotal tras el primer descuento %. */
  subtotalTras1: number;
  /** Subtotal neto final tras el segundo descuento % (sobre el resultado del 1º). */
  subtotalNeto: number;
  /** 1er descuento en dinero. */
  descuento1Monto: number;
  /** 2do descuento en dinero (sobre el subtotal ya descontado una vez). */
  descuento2Monto: number;
  /** Suma de ambos descuentos en dinero. */
  descuentoTotalMonto: number;
  /** Costo unitario neto después de ambos descuentos (lo que realmente se paga). */
  costoUnitNeto: number;
}

/**
 * Aplica dos descuentos PORCENTUALES encadenados sobre una línea.
 *
 *   bruto            = costoUnit × cantidad
 *   tras 1º           = bruto × (1 − d1/100)
 *   neto (tras 2º)   = tras 1º × (1 − d2/100)
 *
 * `descuento2` se calcula SOBRE `subtotalTras1` (encadenado), no sobre el bruto.
 * Los porcentajes se acotan a [0, 100] para que un dato corrupto nunca produzca
 * un subtotal negativo.
 */
export function aplicarDescuentosLinea(
  costoUnit: number,
  cantidad: number,
  descuento1Pct: number,
  descuento2Pct: number,
  decimales = 6
): DescontosLinea {
  const cu = Number(costoUnit);
  const cant = Number(cantidad);
  const d1 = Math.min(100, Math.max(0, Number(descuento1Pct) || 0));
  const d2 = Math.min(100, Math.max(0, Number(descuento2Pct) || 0));

  const subtotalBruto = redondear((Number.isFinite(cu) ? cu : 0) * (Number.isFinite(cant) ? cant : 0), decimales);
  const factor1 = 1 - d1 / 100;
  const subtotalTras1 = redondear(subtotalBruto * factor1, decimales);
  const factor2 = 1 - d2 / 100;
  const subtotalNeto = redondear(subtotalTras1 * factor2, decimales);

  const descuento1Monto = redondear(subtotalBruto - subtotalTras1, decimales);
  const descuento2Monto = redondear(subtotalTras1 - subtotalNeto, decimales);
  const descuentoTotalMonto = redondear(descuento1Monto + descuento2Monto, decimales);

  // Costo unitario neto: lo que entra al CPP (el precio REAL pagado).
  const costoUnitNeto = cant > 0 ? redondear(subtotalNeto / cant, decimales) : redondear(subtotalNeto, decimales);

  return {
    subtotalBruto,
    subtotalTras1,
    subtotalNeto,
    descuento1Monto,
    descuento2Monto,
    descuentoTotalMonto,
    costoUnitNeto,
  };
}

export interface ResumenFactura {
  /** Suma de los subtotales de lista de todas las líneas. */
  brutoLineas: number;
  /** Total de descuentos por línea (suma de ambos). */
  descuentoLineas: number;
  /** Subtotal de las líneas ya descontadas (antes del general). */
  subtotalNetoLineas: number;
  /** Descuento general en dinero. */
  descuentoGeneralMonto: number;
  /** TOTAL final a pagar. */
  total: number;
}

/**
 * Consolida los subtotales NETOS de las líneas (ya con sus dos descuentos) y
 * aplica el descuento GENERAL de la factura sobre ese resultado.
 *
 * El descuento general se calcula sobre el neto de líneas: así los tres
 * conceptos se leen como una cascada y el total nunca es negativo.
 */
export function calcularTotalConDescuentos(
  subtotalesNetosLineas: number[],
  descuentoGeneralPct: number,
  decimales = 6
): ResumenFactura {
  const brutoLineas = redondear(
    subtotalesNetosLineas.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0),
    decimales
  );
  const dg = Math.min(100, Math.max(0, Number(descuentoGeneralPct) || 0));
  const subtotalNetoLineas = brutoLineas;
  const descuentoGeneralMonto = redondear(subtotalNetoLineas * (dg / 100), decimales);
  const total = redondear(Math.max(0, subtotalNetoLineas - descuentoGeneralMonto), decimales);
  return {
    brutoLineas,
    descuentoLineas: 0, // lo calcula el caller (por línea); se mantiene para el shape
    subtotalNetoLineas,
    descuentoGeneralMonto,
    total,
  };
}

export type ModoVentaPresentacion = "derivado" | "fijo" | "margen";

/**
 * Fila de presentación lista para el cliente: el precio YA resuelto según su
 * modo, más los overrides CRUDOS para que el formulario pueda reenviarlos sin
 * perderlos (si solo devolviera el precio calculado, un `precio_override`
 * volvería como `undefined` y al reenviar la fila caería a 'derivado').
 */
export interface PresentacionCalculada {
  id: string;
  nombre: string;
  unidades: number;
  activo: boolean;
  /**
   * Código de barras PROPIO de la caja (opcional). Es `null` cuando la caja no
   * tiene código asignado: en ese caso solo se agrega desde el desplegable,
   * nunca escaneando.
   */
  codigo: string | null;
  /** Precio de VENTA de la presentación completa, ya resuelto según el modo. */
  precio: number;
  /** Precio por UNIDAD dentro de la presentación (= precio ÷ unidades). */
  precioUnitario: number;
  /** Costo de la presentación: SIEMPRE derivado (CPP × unidades). */
  costo: number;
  /** Modo con el que se resolvió `precio`. */
  modo_venta: ModoVentaPresentacion;
  /** Override de precio del modo 'fijo' (null en los demás modos). */
  precio_override: number | null;
  /** Override de margen % del modo 'margen' (null en los demás modos). */
  margen_override: number | null;
  /** Margen % implícito de la venta de la presentación completa. */
  margen: number | null;
  /** true si el precio quedó por debajo del costo (se vendería con pérdida). */
  bajoCosto: boolean;
  /**
   * true si vender la caja completa sale MÁS BARATA por unidad que vender el
   * detalle. No es error de cálculo, pero casi siempre es un error de captura.
   */
  masBarataQueDetalle: boolean;
}

export interface PresentacionCalculadaInput {
  id: string | number;
  nombre: string;
  unidades: number | string;
  activo?: boolean | null;
  codigo?: string | null;
  modo_venta?: string | null;
  precio_override?: number | string | null;
  margen_override?: number | string | null;
}

/**
 * Resuelve el precio de UNA presentación según su modo.
 *
 *   derivado → precioUnidad × unidades
 *   fijo     → precio_override (independiente del CPP)
 *   margen   → costoUnitario × unidades × (1 + margen_override/100)
 *
 * El COSTO nunca se guarda: se deriva siempre del CPP (o del costo estático si
 * el producto aún no tiene CPP). Así el inventario y el kardex siguen cuadrando
 * contra la cascada de precios.
 *
 * `modo_venta` nulo o desconocido cae a 'derivado' (retrocompatible).
 */
export function precioPresentacionSegunModo(params: {
  unidades: number;
  /** Precio de venta por unidad del producto. */
  precioUnidad: number;
  /** Costo por unidad del producto (CPP si existe; si no, el costo estático). */
  costoUnitario: number;
  modo?: string | null;
  precioOverride?: number | string | null;
  margenOverride?: number | string | null;
  decimales?: number;
}): {
  precio: number;
  precioUnitario: number;
  costo: number;
  modo_venta: ModoVentaPresentacion;
  margen: number | null;
  bajoCosto: boolean;
  masBarataQueDetalle: boolean;
} {
  const dec = params.decimales ?? 2;
  const u = Number.isFinite(params.unidades) && params.unidades > 1 ? params.unidades : 0;
  if (u <= 0) {
    return {
      precio: 0,
      precioUnitario: 0,
      costo: 0,
      modo_venta: "derivado",
      margen: null,
      bajoCosto: false,
      masBarataQueDetalle: false,
    };
  }

  const precioUnidad = Number.isFinite(params.precioUnidad) ? params.precioUnidad : 0;
  const costoUnitario = Number.isFinite(params.costoUnitario) ? params.costoUnitario : 0;
  const costo = redondear(costoUnitario * u, dec);

  const modoCrudo = String(params.modo ?? "derivado");
  const modo: ModoVentaPresentacion =
    modoCrudo === "fijo" || modoCrudo === "margen" ? (modoCrudo as ModoVentaPresentacion) : "derivado";

  let precio: number;
  if (modo === "fijo") {
    const ov = params.precioOverride;
    const n = ov === null || ov === undefined || ov === "" ? NaN : Number(ov);
    precio = Number.isFinite(n) && n >= 0 ? redondear(n, dec) : redondear(precioUnidad * u, dec);
  } else if (modo === "margen") {
    const mg = params.margenOverride;
    const m = Number.isFinite(Number(mg)) && Number(mg) >= 0 ? Number(mg) : 0;
    // Se apoya en el COSTO (CPP) para que el margen sobreviva a las compras.
    precio = redondear(costo * (1 + m / 100), dec);
  } else {
    precio = redondear(precioUnidad * u, dec);
  }

  const precioUnitario = redondear(precio / u, dec);
  // Misma convención que `margen_ganancia` en toda la app:
  //   margen % = (precio − costo) / costo × 100   ⇔   precio = costo × (1 + m/100)
  const margen = costo > 0 ? redondear(((precio - costo) / costo) * 100, 2) : null;

  return {
    precio,
    precioUnitario,
    costo,
    modo_venta: modo,
    margen,
    bajoCosto: costo > 0 && precio < costo,
    masBarataQueDetalle: precioUnitario > 0 && precioUnidad > 0 && precioUnitario < precioUnidad,
  };
}

/**
 * `precio` se resuelve según el modo de cada presentación (derivado / fijo /
 * margen) y `costo` SIEMPRE deriva del costo por unidad del producto.
 * Incluye TODAS las presentaciones (activas e inactivas) con su flag.
 */
export function presentacionesDeProducto(
  producto: {
    precio_base?: number | string | null;
    costo_base?: number | string | null;
    /** CPP por unidad (moneda del producto). Si no existe, cae a `costo_base`. */
    costo_promedio?: number | string | null;
    moneda_base_id?: string | null;
    moneda_costo_id?: string | null;
  } | null | undefined,
  presentaciones: PresentacionCalculadaInput[] | null | undefined,
  decimales = 2,
  /**
   * Costo por unidad YA CONVERTIDO a la moneda de venta. El precio de la
   * presentación vive en la moneda de venta, así que el modo 'margen' necesita
   * el costo en esa misma moneda. Si no se pasa, se usa `costo_promedio` (o
   * `costo_base`) tal cual — correcto solo si el producto no cambia de moneda.
   */
  costoUnitarioVenta?: number | null
): PresentacionCalculada[] {
  if (!presentaciones) return [];
  const precioBaseN = Number(producto?.precio_base);
  const precioBase = Number.isFinite(precioBaseN) ? precioBaseN : 0;

  // El CPP manda; si el producto aún no tiene compras, se usa el costo estático.
  const cppN = Number(producto?.costo_promedio);
  const costoBaseN = Number(producto?.costo_base);
  const costoUnitario =
    costoUnitarioVenta !== null && costoUnitarioVenta !== undefined && Number.isFinite(costoUnitarioVenta) && costoUnitarioVenta > 0
      ? costoUnitarioVenta
      : Number.isFinite(cppN) && cppN > 0
        ? cppN
        : Number.isFinite(costoBaseN)
          ? costoBaseN
          : 0;

  return presentaciones.map((p) => {
    const unidades = Number(p.unidades);
    const r = precioPresentacionSegunModo({
      unidades,
      precioUnidad: precioBase,
      costoUnitario,
      modo: p.modo_venta,
      precioOverride: p.precio_override,
      margenOverride: p.margen_override,
      decimales,
    });
    // Los overrides se devuelven CRUDOS (no el precio ya calculado): sin ellos
    // el formulario no puede reenviarlos y el modo se degradaría a 'derivado'.
    const po = p.precio_override === null || p.precio_override === undefined || p.precio_override === "" ? null : Number(p.precio_override);
    const mo = p.margen_override === null || p.margen_override === undefined || p.margen_override === "" ? null : Number(p.margen_override);
    return {
      id: String(p.id),
      nombre: p.nombre,
      unidades: Number.isFinite(unidades) && unidades > 1 ? unidades : 0,
      activo: p.activo !== false,
      codigo: p.codigo ? String(p.codigo).trim() || null : null,
      precio_override: Number.isFinite(po as number) ? (po as number) : null,
      margen_override: Number.isFinite(mo as number) ? (mo as number) : null,
      ...r,
    };
  });
}
