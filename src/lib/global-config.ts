// ============================================================================
// POSBIT - Configuración Global tipada (reglas del motor Set & Forget)
// ----------------------------------------------------------------------------
// Lee la fila única de `configuracion_global`. Estas reglas se consultan ANTES
// de cualquier operación de costeo (compras) para que los operadores no tengan
// que configurar tasas/métodos transacción por transacción.
//
// `client` es opcional: si llega un cliente de transacción (pg), la lectura se
// hace DENTRO de la misma transacción (consistencia entre los UPDATEs y la
// regla leída). Sin cliente usa el pool global.
// ============================================================================

export type MetodoConversion = "directa" | "triangulacion";

export interface ConfiguracionGlobal {
  metodo_conversion_compras: MetodoConversion;
  metodo_conversion_ventas: MetodoConversion;
  /** Moneda de tránsito obligatoria cuando el método es 'triangulacion'. */
  moneda_transito_compras_id: string | null;
  moneda_transito_ventas_id: string | null;
  /** Toggle maestro: recálculo automático del precio de venta tras compra. */
  auto_precio_compra: boolean;
  /**
   * Método de costeo (Configuración → Inventario): 'Promedio' | 'FIFO' | 'LIFO'.
   * Solo 'Promedio' (CPP) está implementado: es el único que calcula/aplica el
   * costo promedio ponderado al comprar. Los demás no tocan el CPP.
   */
  metodo_costeo: string;
  redondeo_activo: boolean;
  /** Múltiplo de redondeo global (100, 500...). 0 = sin redondeo. */
  redondeo_multiplo: number;
  /** Evita que el redondeo deje el precio por debajo del costo. */
  redondeo_no_bajar_de_costo: boolean;
}

const DEFAULTS: ConfiguracionGlobal = {
  metodo_conversion_compras: "directa",
  metodo_conversion_ventas: "directa",
  moneda_transito_compras_id: null,
  moneda_transito_ventas_id: null,
  auto_precio_compra: true,
  metodo_costeo: "Promedio",
  redondeo_activo: false,
  redondeo_multiplo: 0,
  redondeo_no_bajar_de_costo: true,
};

/** Mapea la fila SQL (text/boolean/number) al tipo tipado. */
export function parsearConfiguracionGlobal(fila: any): ConfiguracionGlobal {
  if (!fila) return { ...DEFAULTS };
  return {
    metodo_conversion_compras: fila.metodo_conversion_compras === "triangulacion" ? "triangulacion" : "directa",
    metodo_conversion_ventas: fila.metodo_conversion_ventas === "triangulacion" ? "triangulacion" : "directa",
    moneda_transito_compras_id: fila.moneda_transito_compras_id ?? null,
    moneda_transito_ventas_id: fila.moneda_transito_ventas_id ?? null,
    auto_precio_compra: fila.auto_precio_compra !== false,
    // `metodo_costeo` NO vive en `configuracion_global` (tabla clave-valor
    // `configuracion`); aquí solo se deja el default. `getConfiguracionGlobal`
    // lo sobreescribe con el valor real.
    metodo_costeo: String(fila.metodo_costeo ?? "Promedio"),
    redondeo_activo: fila.redondeo_activo === true,
    redondeo_multiplo: Number(fila.redondeo_multiplo) > 0 ? Number(fila.redondeo_multiplo) : 0,
    redondeo_no_bajar_de_costo: fila.redondeo_no_bajar_de_costo !== false,
  };
}

type Queryable = {
  /** Acepta el helper global de la app (`query` → devuelve filas) y el
   *  cliente pg de transacción (`client.query` → devuelve `{ rows }`). */
  query: (text: string, params?: any[]) => Promise<any[] | { rows: any[] }>;
};

export async function getConfiguracionGlobal(client?: Queryable): Promise<ConfiguracionGlobal> {
  try {
    // Import diferido: el resto de este módulo es puro (sin DB) para poder
    // testearlo con Node sin levantar la pila de la app.
    const { query } = await import("@/lib/db");
    const q = client ?? ({ query } as Queryable);
    const res = await q.query(`SELECT * FROM configuracion_global WHERE id = 1`);
    const fila =
      Array.isArray(res) ? res[0]
      : Array.isArray((res as any)?.rows) ? (res as any).rows[0]
      : undefined;
    const cfg = parsearConfiguracionGlobal(fila);

    // El método de costeo vive en la tabla clave-valor `configuracion`
    // (Configuración → Inventario). Se lee aquí para que todo el motor comparta
    // la misma regla (solo 'Promedio' aplica el CPP al comprar).
    const resMetodo = await q.query(`SELECT valor FROM configuracion WHERE clave = 'inventario_metodo_costeo'`).catch(() => []);
    const filaMetodo =
      Array.isArray(resMetodo) ? resMetodo[0]
      : Array.isArray((resMetodo as any)?.rows) ? (resMetodo as any).rows[0]
      : undefined;
    cfg.metodo_costeo = String(filaMetodo?.valor ?? "Promedio");
    return cfg;
  } catch (err: any) {
    console.warn("Aviso: configuracion_global no disponible, usando defaults:", err?.message || err);
    return { ...DEFAULTS };
  }
}

/**
 * ¿El método de costeo activo calcula y aplica el CPP? Solo 'Promedio' (CPP)
 * está implementado; FIFO/LIFO no tocan el costo promedio ponderado.
 */
export function usaCpp(cfgOMetodo: Pick<ConfiguracionGlobal, "metodo_costeo"> | string | null | undefined): boolean {
  const metodo = typeof cfgOMetodo === "string" ? cfgOMetodo : cfgOMetodo?.metodo_costeo;
  return String(metodo ?? "") === "Promedio";
}

/** Convierte el id de tránsito configurado en el objeto moneda del catálogo. */
export function monedaTransitoDe(
  cfg: ConfiguracionGlobal,
  operacion: "compras" | "ventas",
  monedasCatalogo: any[]
): any | null {
  const id = operacion === "compras" ? cfg.moneda_transito_compras_id : cfg.moneda_transito_ventas_id;
  if (!id) return null;
  return monedasCatalogo.find((m) => String(m.id) === String(id)) ?? null;
}