"use client";

import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useRef } from "react";

export type HeaderConfig =
  | string
  | {
      key?: string;
      label: string;
      sortable?: boolean;
      /** Clases extra para la celda de encabezado (p. ej. resaltar una columna). */
      className?: string;
      /**
       * Grupo de la columna. Las columnas CONTIGUAS del mismo grupo se fusionan
       * automáticamente en una cabecera de nivel superior, de modo que "Costo
       * USD / VES / COP" y "Precio USD / VES / COP" se leen como dos bloques en
       * vez de seis columnas sueltas. Sin grupo, la columna se dibuja en la
       * banda neutra de la izquierda.
       */
      group?: string;
    };

interface TableProps {
  headers: HeaderConfig[];
  children: React.ReactNode;
  sortKey?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (key: string) => void;
}

interface FlatHeader {
  label: string;
  key?: string;
  className?: string;
  sortable: boolean;
  group?: string;
}

export function Table({ headers, children, sortKey, sortOrder, onSort }: TableProps) {
  const flat: FlatHeader[] = headers.map((h) =>
    typeof h === "object"
      ? { label: h.label, key: h.key, className: h.className, sortable: !!h.sortable && !!h.key && !!onSort, group: h.group }
      : { label: h, sortable: false }
  );

  const hayGrupos = flat.some((h) => !!h.group);

  // Colapsa columnas contiguas del mismo grupo en tramos con su `colSpan`.
  const tramos: Array<{ label: string | null; span: number }> = [];
  for (const h of flat) {
    const g = h.group ?? null;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.label === g) ultimo.span++;
    else tramos.push({ label: g, span: 1 });
  }

  /**
   * Guarda contra tablas desalineadas.
   *
   * Si el cuerpo tiene más o menos `<Td>` que columnas declara `headers`, la
   * tabla IGUAL renderiza: solo los datos caen bajo el encabezado que no les
   * toca, y no se ve hasta que alguien lo nota. Este aviso lo delata en
   * desarrollo, sin ruido en producción.
   */
  const tablaRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const t = tablaRef.current;
    const fila = t?.querySelector("tbody tr");
    if (!t || !fila) return;
    // Se ignora la fila de estado (carga / sin resultados) porque su celda
    // lleva colSpan y no corresponde una por columna.
    if (fila.querySelectorAll("td").length <= 1) return;
    // Ojo: con grupos hay DOS `<thead>` (la banda de grupos y la fila real de
    // columnas), así que hay que medir solo la última fila de encabezado; si no,
    // los `<th>` de la banda de grupos inflan el conteo y dan falsos positivos.
    const filasEncabezado = t.querySelectorAll("thead tr");
    const ultimaFila = filasEncabezado[filasEncabezado.length - 1];
    const cols = ultimaFila ? ultimaFila.querySelectorAll("th").length : 0;
    const celdas = fila.querySelectorAll("td").length;
    if (cols !== celdas) {
      console.error(
        `[Table] Tabla desalineada: ${cols} columnas pero ${celdas} celdas en la primera fila. ` +
          `Revisa que el orden y la cantidad de <Td> coincidan con \`headers\`.`
      );
    }
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table ref={tablaRef} className="w-full text-sm">
          {hayGrupos && (
            <thead>
              {/* Banda de grupos: recorta visualmente "de un vistazo qué es
                  cada bloque" cuando hay muchas columnas de dinero. */}
              <tr className="border-b border-border bg-muted/70">
                {tramos.map((t, i) => (
                  <th
                    key={i}
                    colSpan={t.span}
                    scope="colgroup"
                    className={cn(
                      "whitespace-nowrap px-4 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.12em]",
                      t.label
                        ? "text-muted-foreground/90 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border/70"
                        : "text-transparent select-none"
                    )}
                  >
                    {t.label ?? "\u00A0"}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {flat.map((h, i) => {
                const isActive = h.sortable && sortKey === h.key;
                return (
                  <th
                    key={h.key || h.label || i}
                    onClick={() => h.sortable && h.key && onSort?.(h.key)}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground select-none",
                      h.className,
                      h.sortable && "cursor-pointer hover:bg-muted/60 hover:text-foreground transition-colors",
                      isActive && "text-primary font-bold"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{h.label}</span>
                      {h.sortable && (
                        <span className="text-muted-foreground/70">
                          {isActive ? (
                            sortOrder === "asc" ? (
                              <ArrowUp size={12} className="text-primary" />
                            ) : (
                              <ArrowDown size={12} className="text-primary" />
                            )
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition-colors hover:bg-muted/20 even:bg-muted/10", className)} {...props} />
  );
}

export function Td({
  mono,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { mono?: boolean }) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-4 py-2.5 text-foreground",
        mono && "font-mono text-xs",
        className
      )}
      {...props}
    />
  );
}
