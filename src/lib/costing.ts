// ============================================================================
// POSBIT - Costeo (CPP), conversión configurable y efecto cascada de precios
// ----------------------------------------------------------------------------
// Servicio central del módulo de Inventario/Pricing. Todo el "cerebro" vive
// aquí para que el controlador de Guardar Compra siga siendo una orquestación
// fina:
//
//   1. El controlador lee `configuracion_global` (set & forget).
//   2. `convertirConMetodo` aplica Directa vs Triangulación.
//   3. `calcularCpp` consolida SOLO valores unitarios en moneda base (USD).
//   4. `aplicarReglasRedondeo` + margen fijan el precio de venta unitario.
//   5. El precio por presentación (Caja = Unidad × factor) se DERIVA solo
//      (src/lib/money.ts `presentacionesDeProducto`): no hay nada que escribir.
//
// Referencias:
//   - Regla de conversión:   src/lib/money.ts (tasaUsd / tasaPar / convertir)
//   - Tabla de reglas:       configuracion_global (fila id = 1)
//   - Migración de esquema:  sql/global-config-pricing.sql
// ============================================================================

import {
  aBase,
  convertirConMetodo as convertirPorMetodo,
  monedaCostoDeProducto,
  monedaDeProducto,
  redondear,
  tasaUsd,
} from "@/lib/money";
import type { ConfiguracionGlobal, MetodoConversion } from "@/lib/global-config";
import { getConfiguracionGlobal, monedaTransitoDe, usaCpp } from "@/lib/global-config";

// ============================================================================
// 1. CONVERSIÓN SEGÚN MÉTODO GLOBAL (Directa vs Triangulación)
// ============================================================================

export interface ContextoConversion {
  metodo: MetodoConversion;
  /** Moneda de tránsito (obligatoria en 'triangulacion'). */
  monedaTransito?: any | null;
  catalogo: any[];
  /**
   * Tasas USD efectivas por id de moneda (p. ej. la tasa personalizada de la
   * factura). Si una moneda está aquí, sus pares usan este valor.
   */
  efectivas?: Record<string, number> | null;
}

/** Construye el contexto de conversión para una operación (compra o venta). */
export function contextoCotizacion(
  cfg: ConfiguracionGlobal,
  operacion: "compras" | "ventas",
  monedasCatalogo: any[],
  efectivas?: Record<string, number> | null
): ContextoConversion {
  return {
    metodo: operacion === "compras" ? cfg.metodo_conversion_compras : cfg.metodo_conversion_ventas,
    monedaTransito: monedaTransitoDe(cfg, operacion, monedasCatalogo),
    catalogo: monedasCatalogo,
    efectivas,
  };
}

/**
 * Convierte `monto` de `desde` a `hasta` según el método global, delegando en
 * la regla ÚNICA de `money.ts` (directa vs triangulación con las tasas
 * efectivas del documento). La lógica vive en `money.ts` para compartirla con
 * el cliente (p. ej. el "PV estimado" del formulario de compras).
 */
export function convertirConMetodo(
  monto: number,
  desde: any | null | undefined,
  hasta: any | null | undefined,
  ctx: ContextoConversion,
  decimales = 2
): number {
  return convertirPorMetodo(
    monto,
    desde,
    hasta,
    {
      metodo: ctx.metodo,
      monedaTransito: ctx.monedaTransito,
      catalogo: ctx.catalogo,
      efectivas: ctx.efectivas,
    },
    decimales
  );
}

// ============================================================================
// 2. CPP (Costo Promedio Ponderado)
// ============================================================================
// Consolidados EXCLUSIVAMENTE en la moneda base (USD) para que compras en
// monedas distintas converjan sin arrastre de tasas:
//
//   cpp_nuevo = (cpp_actual × stock_actual + costo_entrante × cantidad)
//               / (stock_actual + cantidad)
// ============================================================================

export function calcularCpp(args: {
  cppActualBase: number;
  stockActual: number;
  costoUnitarioEntranteBase: number;
  cantidadEntrante: number;
}): number {
  const cpp = Number(args.cppActualBase) || 0;
  const stock = Number(args.stockActual) || 0;
  const costo = Number(args.costoUnitarioEntranteBase) || 0;
  const cantidad = Number(args.cantidadEntrante) || 0;

  if (cantidad <= 0) return redondear(cpp, 6);
  // Primera entrada: el CPP es el costo entrante (un CPP 0/legacy no diluye).
  if (stock <= 0) return redondear(costo, 6);

  const totalAnterior = cpp * stock;
  const totalEntrante = costo * cantidad;
  return redondear((totalAnterior + totalEntrante) / (stock + cantidad), 6);
}

/**
 * Aproximación inicial para productos legacy con stock>0 pero sin
 * `costo_promedio_base`: usar el costo estático convertido a la moneda base
 * (USD). Si llega `ctxCompra` la conversión respeta el método global de
 * compras (directa o triangulación vía la moneda de tránsito); sin ctx se
 * mantiene el comportamiento histórico (directo).
 */
export function costoEstaticoEnBase(
  producto: any,
  monedaCosto: any,
  monedasCatalogo: any[],
  ctxCompra?: ContextoConversion
): number {
  const costo = Number(producto.costo_base);
  if (!Number.isFinite(costo) || costo <= 0) return 0;
  if (ctxCompra) {
    const base = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
    if (base) return redondear(convertirConMetodo(costo, monedaCosto, base, ctxCompra, 6), 6);
  }
  return redondear(aBase(costo, tasaUsd(monedaCosto, monedasCatalogo)), 6);
}

// ============================================================================
// 3. REGLAS DE REDONDEO GLOBAL + PRECIO DE VENTA
// ============================================================================

/** Precio de venta bruto = CPP × (1 + margen/100). El margen nunca es negativo. */
export function precioVentaDesdeCosto(costoUnitarioVenta: number, margen: number): number {
  const m = Number.isFinite(margen) && margen > 0 ? margen : 0;
  return costoUnitarioVenta * (1 + m / 100);
}

/**
 * Aplica la regla global de redondeo al precio.
 * `costoUnitarioVenta` se usa como suelo cuando `redondeo_no_bajar_de_costo`.
 */
export function aplicarReglasRedondeo(
  precio: number,
  cfg: Pick<ConfiguracionGlobal, "redondeo_activo" | "redondeo_multiplo" | "redondeo_no_bajar_de_costo">,
  costoUnitarioVenta: number
): { precio: number; redondeado: boolean } {
  let p = Number(precio);
  let redondeado = false;

  if (cfg.redondeo_activo && Number(cfg.redondeo_multiplo) > 0) {
    const m = Number(cfg.redondeo_multiplo);
    const r = Math.round(p / m) * m;
    redondeado = Math.abs(r - p) > 1e-9;
    p = r;
  }
  p = redondear(p, 2);

  if (cfg.redondeo_no_bajar_de_costo && Number(costoUnitarioVenta) > 0 && p < costoUnitarioVenta) {
    p = redondear(costoUnitarioVenta, 2);
    redondeado = true; // el redondeo pretendía bajar del costo; lo fijamos en costo
  }
  return { precio: p, redondeado };
}

// ============================================================================
// 4. PROCESAMIENTO DE UNA LÍNEA DE COMPRA (EFECTO CASCADA)
// ============================================================================
// Se ejecuta DENTRO de la transacción de crear la compra. El operador jamás ve
// este desglose: la factura muestra lo que él tecleó (ej. "1 Caja").
// ============================================================================

export interface ItemCompraParaCosteo {
  producto_id: number;
  cantidad: number; // SIEMPRE en unidades (ya desglosado por el controlador)
  /** Costo unitario en la moneda de la factura. */
  costo_unit: number;
  /** Costo unitario convertido a moneda base (USD) según el método global. */
  costo_unit_base: number;
  /** Margen de ganancia override (opcional). Si viene, se usa en la cascada y
   *  se persiste en el producto. null/undefined = mantener el del producto. */
  margen?: number | null;
  _presentacion?: {
    id: string | null;
    nombre: string | null;
    unidades: number;
    cantidad_presentaciones: number;
    costo_presentacion: number;
  } | null;
}

export interface ResultadoCascada {
  producto_id: number;
  stock_anterior: number;
  stock_nuevo: number;
  cpp_anterior_base: number;
  cpp_nuevo_base: number;
  cpp_nuevo_moneda_costo: number;
  /** Moneda de COMPRA del producto (para convertir el costo del kardex). */
  monedaCosto?: any;
  precio_anterior?: number;
  precio_nuevo?: number;
  redondeado?: boolean;
}

export async function procesarItemCompra(
  client: any,
  params: {
    item: ItemCompraParaCosteo;
    compraId: string;
    compraNumero: string;
    monedaCompra: any; // moneda de la factura
    monedasCatalogo: any[];
    baseSistema: any; // moneda con es_base = true
    cfg: ConfiguracionGlobal;
    ctxCompra: ContextoConversion;
  }
): Promise<ResultadoCascada> {
  const { item, compraId, compraNumero, monedaCompra, monedasCatalogo, baseSistema, cfg, ctxCompra } = params;

  const prodRes = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
  const producto = prodRes.rows[0];
  const monedaCosto = monedaCostoDeProducto(producto, baseSistema, monedasCatalogo);
  const monedaVenta = monedaDeProducto(producto, baseSistema, monedasCatalogo);

  const stockAnterior = Number(producto.stock) || 0;

  // ¿Aplicar CPP? SOLO si el método de costeo activo es 'Promedio'. Con
  // FIFO/LIFO la compra mueve stock/kardex/histórico pero NO toca el costo
  // promedio ni el precio de venta (esos métodos no están implementados).
  const aplicarCpp = usaCpp(cfg);

  // Margen efectivo: el que el operador ajustó en la compra (si vino) o el
  // configurado en el producto (Set & Forget). Nunca negativo; 0 = sin margen.
  const margenEfectivo =
    item.margen != null && Number.isFinite(Number(item.margen)) && Number(item.margen) >= 0
      ? Number(item.margen)
      : Number(producto.margen_ganancia) || 0;
  const cppBaseLeido = Number(producto.costo_promedio_base) || 0;
  const cppBaseInicial =
    cppBaseLeido > 0
      ? cppBaseLeido
      : costoEstaticoEnBase(producto, monedaCosto, monedasCatalogo, ctxCompra);

  // ── CPP en moneda base (USD) ──────────────────────────────────────────────
  // Con método ≠ 'Promedio' se conserva el CPP vigente (no se re-promedia).
  const cppNuevoBase = aplicarCpp
    ? calcularCpp({
        cppActualBase: cppBaseInicial,
        stockActual: stockAnterior,
        costoUnitarioEntranteBase: item.costo_unit_base,
        cantidadEntrante: item.cantidad,
      })
    : redondear(cppBaseInicial, 6);
  // base → moneda de compra del producto: respeta el método global de compras.
  const cppNuevoMonedaCosto = redondear(
    convertirConMetodo(cppNuevoBase, baseSistema, monedaCosto, ctxCompra, 6),
    6
  );
  const stockNuevo = stockAnterior + item.cantidad;

  const resultado: ResultadoCascada = {
    producto_id: item.producto_id,
    stock_anterior: stockAnterior,
    stock_nuevo: stockNuevo,
    cpp_anterior_base: cppBaseInicial,
    cpp_nuevo_base: cppNuevoBase,
    cpp_nuevo_moneda_costo: cppNuevoMonedaCosto,
    monedaCosto,
  };

  // ── Efecto cascada: recalcular precio de venta tras la compra ────────────
  // La cascada usa el CPP → solo aplica si el método es 'Promedio' (aplicarCpp)
  // y el toggle maestro está encendido.
  if (cfg.auto_precio_compra && aplicarCpp) {
    // base → moneda de venta: la cascada es un efecto de la COMPRA, así que
    // aplica el mismo método global (directa/triangulación) configurado para ella.
    const cppEnMonedaVenta = redondear(
      convertirConMetodo(cppNuevoBase, baseSistema, monedaVenta, ctxCompra, 6),
      6
    );
    const margen = margenEfectivo;
    const precioBruto = precioVentaDesdeCosto(cppEnMonedaVenta, margen);
    const { precio, redondeado } = aplicarReglasRedondeo(precioBruto, cfg, cppEnMonedaVenta);

    resultado.precio_anterior = Number(producto.precio_base) || 0;
    resultado.precio_nuevo = precio;
    resultado.redondeado = redondeado;

    await client.query(
      `UPDATE productos
         SET stock = $1,
             costo_promedio = $2,
             costo_promedio_base = $3,
             precio_base = $4,
             margen_ganancia = $5,
             precio_auto = true,
             precio_actualizado_en = NOW()
       WHERE id = $6`,
      [stockNuevo, cppNuevoMonedaCosto, cppNuevoBase, precio, margenEfectivo, item.producto_id]
    );
  } else if (aplicarCpp) {
    // Sin cascada (toggle off) o método ≠ 'Promedio': solo stock + CPP
    // (conservado) + margen; el precio de venta no se toca.
    await client.query(
      `UPDATE productos
         SET stock = $1, costo_promedio = $2, costo_promedio_base = $3, margen_ganancia = $4
       WHERE id = $5`,
      [stockNuevo, cppNuevoMonedaCosto, cppNuevoBase, margenEfectivo, item.producto_id]
    );
  } else {
    // Metodo distinto de 'Promedio' (FIFO/LIFO, no implementados): la compra
    // solo mueve stock y persiste el margen; el costo promedio y el precio de
    // venta no se tocan.
    await client.query(
      `UPDATE productos
         SET stock = $1, margen_ganancia = $2
        WHERE id = $3`,
      [stockNuevo, margenEfectivo, item.producto_id]
    );
  }

  // ── Histórico para autocompletar costos futuros ──────────────────────────
  const pres = item._presentacion;
  await client.query(
    `INSERT INTO producto_costos_historicos
       (producto_id, compra_id, moneda_id, cantidad,
        presentacion_id, presentacion_nombre, presentacion_unidades,
        cantidad_presentaciones, costo_presentacion, costo_unit, costo_unit_base, fecha)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_DATE)`,
    [
      item.producto_id,
      compraId,
      monedaCompra.id,
      item.cantidad,
      pres?.id ?? null,
      pres?.nombre ?? null,
      pres?.unidades ?? null,
      pres?.cantidad_presentaciones ?? null,
      pres?.costo_presentacion ?? null,
      item.costo_unit,
      item.costo_unit_base,
    ]
  );

  void compraNumero; // (disponible para trazabilidad futura)
  // Nota: el kardex lo inserta el controlador (mantiene el orden compra→kardex).

  return resultado;
}

// ============================================================================
// 5. AUTODOCUMENTACIÓN DE COSTOS (autocompletado en compras)
// ============================================================================

/** Normaliza el resultado de `query` (filas directas) y `client.query` ({rows}). */
async function filasDe(q: any, text: string, params?: any[]): Promise<any[]> {
  if (!q) return [];
  const res = typeof q === "function" ? await q(text, params) : typeof q.query === "function" ? await q.query(text, params) : [];
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

/**
 * Histórico de costos pagados para autocompletar el formulario de compras.
 *
 * - Si llega `presentacionId`: devuelve el historial de ESA presentación
 *   (Caja, Bolsa...).
 * - Si NO llega: devuelve solo el historial por UNIDAD (`presentacion_id IS
 *   NULL`). Así, al comprar por unidad nunca se sugiere el precio de una caja.
 *
 * Es el "precio de compra histórico": el ÚLTIMO precio realmente pagado, NUNCA
 * el CPP (el promedio ponderado es solo para calcular el precio de venta).
 */
export async function ultimosCostosDeProducto(
  client: any,
  productoId: number,
  opts?: { monedaId?: string | null; presentacionId?: string | null; limite?: number }
): Promise<any[]> {
  const limite = opts?.limite ?? 20;
  return filasDe(
    client,
    `SELECT h.*, mo.codigo AS moneda_codigo, mo.simbolo AS moneda_simbolo
       FROM producto_costos_historicos h
       LEFT JOIN monedas mo ON mo.id = h.moneda_id
      WHERE h.producto_id = $1
        AND ($2::text IS NULL OR h.moneda_id::text = $2)
        AND (
          CASE WHEN $3::text IS NULL THEN h.presentacion_id IS NULL
               ELSE h.presentacion_id::text = $3 END
        )
      ORDER BY h.fecha DESC, h.creado_en DESC
      LIMIT $4`,
    [productoId, opts?.monedaId ?? null, opts?.presentacionId ?? null, limite]
  );
}

// ============================================================================
// 6. HERRAMIENTAS ADMIN (cambio de reglas en medio de la jornada)
// ============================================================================

/**
 * Recompleta el CPP de un producto REPLAYANDO el kardex en orden cronológico.
 * Úsalo al anular una compra o tras un ajuste: el promedio ponderado no se
 * puede "deshacer" algebraicamente, pero sí se puede recomputar desde el
 * historial. Las entradas de una compra y su registro 'compra_anulada' se
 * excluyen EN PAR (referencia_id = id de compra), así el promedio queda como
 * si la compra nunca hubiera existido.
 */
export async function recomputarCppDesdeKardex(
  client: any,
  productoId: number,
  monedasCatalogo: any[],
  baseSistema: any
): Promise<{ cpp_base: number; cpp_moneda_costo: number }> {
  const res = await client.query(
    `SELECT tipo, motivo, cantidad, costo_unit_base, referencia_tipo, referencia_id
       FROM kardex
      WHERE producto_id = $1
      ORDER BY fecha, id`,
    [productoId]
  );

  // Compras anuladas: TODAS sus líneas de kardex (Entrada 'Compra X' y Salida
  // 'compra_anulada') se descartan, porque el efecto neto en stock es cero.
  const anuladas = new Set<string>();
  for (const fila of res.rows) {
    if (String(fila.tipo) === "Salida" && String(fila.referencia_tipo) === "compra_anulada" && fila.referencia_id != null) {
      anuladas.add(String(fila.referencia_id));
    }
  }

  let stock = 0;
  let cppBase = 0;
  for (const fila of res.rows) {
    if (fila.referencia_id != null && anuladas.has(String(fila.referencia_id))) continue;
    const cantidad = Number(fila.cantidad) || 0;
    const tipo = String(fila.tipo);
    const motivo = String(fila.motivo ?? "").toLowerCase();

    if (tipo === "Entrada") {
      if (motivo.includes("anulada")) {
        // Devolución de venta anulada: vuelve stock al promedio vigente.
        stock += cantidad;
      } else {
        // Entrada real (compra): se fusiona al promedio ponderado.
        cppBase = calcularCpp({
          cppActualBase: cppBase,
          stockActual: stock,
          costoUnitarioEntranteBase: Number(fila.costo_unit_base) || 0,
          cantidadEntrante: cantidad,
        });
        stock += cantidad;
      }
    } else if (tipo === "Ajuste") {
      // En ajustes `cantidad` ya viene firmada (+ entrada / − salida).
      stock = Math.max(0, stock + cantidad);
    } else {
      // 'Salida' (venta, compra_anulada): baja stock sin alterar el CPP.
      stock = Math.max(0, stock - cantidad);
    }
  }

  const prod = (await client.query(`SELECT * FROM productos WHERE id = $1`, [productoId])).rows[0];
  const monedaCosto = monedaCostoDeProducto(prod, baseSistema, monedasCatalogo);
  // Mismo método global de compras que la cascada, para que `costo_promedio`
  // (en moneda de compra) quede consistente al recomputar desde el kardex.
  const cfg = await getConfiguracionGlobal(client);
  const ctxCompra = contextoCotizacion(cfg, "compras", monedasCatalogo);
  const cppMonedaCosto = redondear(convertirConMetodo(cppBase, baseSistema, monedaCosto, ctxCompra, 6), 6);

  // Solo se persiste el CPP si el método activo es 'Promedio'. Con FIFO/LIFO el
  // CPP nunca se aplicó, así que recomputarlo dejaría un valor inconsistente.
  if (usaCpp(cfg)) {
    await client.query(
      `UPDATE productos SET costo_promedio = $1, costo_promedio_base = $2 WHERE id = $3`,
      [cppMonedaCosto, cppBase, productoId]
    );
  }
  return { cpp_base: cppBase, cpp_moneda_costo: cppMonedaCosto };
}

/**
 * Job admin "Recalcular precios de venta": re-aplica margen + redondeo GLOBAL
 * vigente (leídos de la BD en este momento) usando el CPP actual. Solo toca
 * productos con `precio_auto = true` para no pisar precios definidos a mano.
 * Responde al caso borde de "cambiaron el múltiplo de redondeo a mitad de
 * jornada": los precios ya fijados NO se mueven solos; este job realinea los
 * automáticos cuando el administrador lo dispare.
 */
export async function recalcularPreciosMasivo(
  client: any,
  cfg: ConfiguracionGlobal,
  monedasCatalogo: any[],
  baseSistema: any
): Promise<Array<{ producto_id: number; precio_anterior: number; precio_nuevo: number; redondeado: boolean }>> {
  const res = await client.query(
    `SELECT p.*
       FROM productos p
      WHERE p.precio_auto = true AND p.activo = true`
  );

  // La cascada y este job deben usar el MISMO método global de compras; si no,
  // "Recalcular precios" revertiría los precios a la conversión directa.
  const ctxCompra = contextoCotizacion(cfg, "compras", monedasCatalogo);

  const actualizados: Array<{ producto_id: number; precio_anterior: number; precio_nuevo: number; redondeado: boolean }> = [];
  for (const producto of res.rows) {
    const monedaVenta = monedaDeProducto(producto, baseSistema, monedasCatalogo);
    const cppBase = Number(producto.costo_promedio_base) || 0;
    if (cppBase <= 0) continue; // sin CPP confiable → no tocar
    const cppEnMonedaVenta = redondear(convertirConMetodo(cppBase, baseSistema, monedaVenta, ctxCompra, 6), 6);
    const margen = Number(producto.margen_ganancia) || 0;
    const { precio, redondeado } = aplicarReglasRedondeo(
      precioVentaDesdeCosto(cppEnMonedaVenta, margen),
      cfg,
      cppEnMonedaVenta
    );
    const anterior = Number(producto.precio_base) || 0;
    if (Math.abs(precio - anterior) > 1e-9) {
      await client.query(
        `UPDATE productos SET precio_base = $1, precio_actualizado_en = NOW() WHERE id = $2`,
        [precio, producto.id]
      );
    }
    actualizados.push({ producto_id: producto.id, precio_anterior: anterior, precio_nuevo: precio, redondeado });
  }
  return actualizados;
}