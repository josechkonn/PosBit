// ============================================================================
// POSBIT - Regla global de redondeo de precios (módulo PURO)
// ----------------------------------------------------------------------------
// Vive solo aquí, y no en `costing.ts`, por una razón concreta: el modal de
// producto es un Client Component y necesita la MISMA función para previsualizar
// lo que hará el servidor. `costing.ts` importa `@/lib/db` (vía
// `global-config`), así que usarlo desde el navegador arrastraría `pg` al
// bundle y rompería la build.
//
// Esta función no toca la base de datos: dada una configuración y un precio,
// devuelve el precio. El servidor la usa igual que el navegador, así que lo que
// se ve antes de guardar es exactamente lo que queda guardado.
// ============================================================================

/**
 * Subconjunto de la configuración global que interviene en el redondeo.
 * Se declara local (y no se importa de `global-config.ts`) para que este módulo
 * siga siendo 100% puro: importar solo el tipo tampoco genera código en el
 * bundle, pero mantenerlo local evita cualquier dependencia con la capa de BD.
 */
export interface ReglasRedondeo {
  /** Toggle maestro de Configuración → Precios. */
  redondeo_activo: boolean;
  /** Múltiplo al que se ajusta el precio (100, 500, 0.50...). 0 = sin redondeo. */
  redondeo_multiplo: number;
  /** Impide que el redondeo deje el precio por debajo del costo. */
  redondeo_no_bajar_de_costo: boolean;
}

/** Redondeo a los decimales indicados, sin dependencias externas. */
function redondearA(valor: number, decimales: number): number {
  const f = Math.pow(10, Math.max(0, Math.min(10, Math.trunc(decimales))));
  return Math.round((Number(valor) + Number.EPSILON) * f) / f;
}

/**
 * Aplica la regla global de redondeo al precio.
 *
 * - Si el redondeo está activo y hay múltiplo, ajusta al múltiplo más cercano
 *   (`Math.round`, no trunca: 23,47 con múltiplo 5 va a 25, no a 20).
 * - Si `redondeo_no_bajar_de_costo`, el precio nunca queda por debajo de
 *   `costoUnitarioVenta`: si el múltiplo intentara bajarlo, se fija en el costo.
 * - `redondeado` dice si el valor cambió, para poder avisar o no al operador.
 */
export function aplicarReglasRedondeo(
  precio: number,
  cfg: ReglasRedondeo,
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
  p = redondearA(p, 2);

  if (cfg.redondeo_no_bajar_de_costo && Number(costoUnitarioVenta) > 0 && p < costoUnitarioVenta) {
    p = redondearA(costoUnitarioVenta, 2);
    redondeado = true; // el redondeo pretendía bajar del costo; lo fijamos en costo
  }
  return { precio: p, redondeado };
}
