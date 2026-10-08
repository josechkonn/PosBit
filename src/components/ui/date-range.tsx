"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Modo = "anio" | "mes" | "dia";

const modos: { id: Modo; label: string }[] = [
  { id: "anio", label: "Año" },
  { id: "mes", label: "Mes" },
  { id: "dia", label: "Día" },
];

interface DateRangeFilterProps {
  desde: string;
  hasta: string;
  onChange: (desde: string, hasta: string) => void;
}

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangoPara(modo: Modo): [string, string] {
  const h = hoy();
  if (modo === "dia") return [h, h];
  const anio = h.slice(0, 4);
  if (modo === "mes") return [`${anio}-${h.slice(5, 7)}-01`, h];
  return [`${anio}-01-01`, h];
}

function formatear(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function isoDeFecha(f: Date): string {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

export function DateRangeFilter({ desde, hasta, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [draftEnd, setDraftEnd] = useState<string | null>(null);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const modoActivo = modos.find((m) => {
    const [d, h] = rangoPara(m.id);
    return d === desde && h === hasta;
  })?.id ?? null;

  const hasRange = Boolean(desde || hasta);

  const days = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startOffset = (firstDay.getDay() + 6) % 7; // lunes primero
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d));
    return cells;
  }, [viewYear, viewMonth]);

  const handleDayClick = (iso: string) => {
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(iso);
      setDraftEnd(null);
      return;
    }
    // draftStart set, draftEnd null
    if (iso < draftStart) {
      setDraftStart(iso);
      setDraftEnd(draftStart);
      onChange(iso, draftStart);
    } else {
      setDraftEnd(iso);
      onChange(draftStart, iso);
    }
    setOpen(false);
  };

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const isInRange = (iso: string) => {
    if (draftStart && draftEnd) return iso >= draftStart && iso <= draftEnd;
    if (draftStart && !draftEnd) return iso === draftStart;
    if (desde && hasta && desde !== hasta) return iso >= desde && iso <= hasta;
    return false;
  };

  const isStart = (iso: string) => iso === (draftStart || desde);
  const isEnd = (iso: string) => iso === (draftEnd || hasta);

  const mesLabel = new Date(viewYear, viewMonth).toLocaleString("es-ES", { month: "long", year: "numeric" });

  return (
    <div className="relative flex flex-wrap items-center gap-2" ref={ref}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Calendar size={13} />
        Período:
      </span>

      <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
        {modos.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              const [d, h] = rangoPara(m.id);
              onChange(d, h);
            }}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              modoActivo === m.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Trigger del calendario */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent",
          open && "border-primary ring-1 ring-ring"
        )}
      >
        <Calendar size={14} />
        {desde && hasta ? `${formatear(desde)} → ${formatear(hasta)}` : "Rango personalizado"}
      </button>

      {/* Popover calendario */}
      {open && (
        <Card className="absolute top-full left-0 z-50 mt-1 w-72 p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="rounded p-1 hover:bg-muted">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium capitalize">{mesLabel}</span>
            <button type="button" onClick={nextMonth} className="rounded p-1 hover:bg-muted">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
            {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} className="h-7 w-7" />;
              const iso = isoDeFecha(day);
              const selected = isStart(iso) || isEnd(iso);
              const inRange = !selected && isInRange(iso);

              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => handleDayClick(iso)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded text-xs transition-colors",
                    selected && "bg-primary text-primary-foreground font-semibold",
                    inRange && "bg-primary/20",
                    !selected && !inRange && "hover:bg-accent"
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          {draftStart && !draftEnd && (
            <div className="mt-2 text-xs text-muted-foreground">
              Selecciona la fecha final…
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </div>
        </Card>
      )}

      {hasRange && (
        <Button variant="ghost" size="sm" onClick={() => onChange("", "")}>
          <X size={13} />
          Limpiar
        </Button>
      )}
    </div>
  );
}
