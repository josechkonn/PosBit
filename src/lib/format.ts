export const fmt = (n: number | string, currency = "USD") => {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "N/A";
  try {
    return new Intl.NumberFormat("es-BO", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
};

/**
 * Formatea un número según los decimales de la moneda (sin símbolo de moneda,
 * solo el número). Úsalo en inputs, tablas y badges donde el contexto ya
 * indique la moneda (ej. "Costo (USD)").
 */
export const fmtMoneda = (n: number | string, decimales = 2) => {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(num);
};

/**
 * Formatea con símbolo y decimales de la moneda. Úsalo en vistas/resúmenes.
 */
export const fmtMonedaConSimbolo = (n: number | string, simbolo: string, decimales = 2) => {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return `${simbolo} 0`;
  return `${simbolo} ${new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(num)}`;
};

export const fmtDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-BO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const fmtDateTime = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-BO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** Solo la hora (HH:MM) de un timestamp; útil para ventas registradas el mismo día. */
export const fmtHora = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
};

export const fmtNumber = (n: number | string) => {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("es-BO").format(num);
};

/**
 * Fecha local en formato `YYYY-MM-DD`: el día que ve el operador.
 *
 * NO usar `new Date().toISOString().split("T")[0]` para esto. `toISOString()`
 * devuelve la fecha en **UTC**, que en Venezuela (UTC-4) ya es del día
 * siguiente a partir de las 20:00: una venta hecha a las 8:30 pm quedaba
 * guardada con la fecha del día siguiente y no aparecía en el reporte del día.
 *
 * Se construye con los getters locales (`getFullYear`/`getMonth`/`getDate`), por
 * eso es la fecha del reloj del operador y no la de UTC. Sirve igual en el
 * cliente y en el servidor (ambos corren en la zona horaria del equipo).
 */
export const fechaLocalISO = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Formatea una tasa sin ceros sobrantes: 3200.0000 → "3200", 3.500000 → "3.5". */
export const fmtTasa = (n: number | string) => {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "0";
  return String(parseFloat(num.toFixed(6)));
};
