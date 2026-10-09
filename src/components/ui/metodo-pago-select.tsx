"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight,
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  Landmark,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetodoPagoOption {
  id: string;
  nombre: string;
  tipo?: string;
  moneda_codigo?: string | null;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface MetodoPagoSelectProps {
  metodos: MetodoPagoOption[];
  /** id del método seleccionado (null/"" = ninguno) */
  value: number | string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Muestra una fila vacía para deseleccionar ("Sin método de pago", etc.) */
  allowEmptyLabel?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

const GAP = 6;
const MAX_HEIGHT = 260;

// Icono y color de fondo según el tipo de método de pago
const TIPOS: Record<string, { icono: LucideIcon; color: string }> = {
  efectivo: { icono: Banknote, color: "bg-success-soft text-success-strong" },
  electronico: { icono: Landmark, color: "bg-info-soft text-info-strong" },
  transferencia: { icono: Landmark, color: "bg-info-soft text-info-strong" },
  tarjeta: { icono: CreditCard, color: "bg-warning-soft text-warning-strong" },
};
const TIPO_POR_DEFECTO = { icono: Wallet, color: "bg-muted text-muted-foreground" };

// Insignia de moneda (código) con su color
const MONEDAS: Record<string, string> = {
  USD: "border-success-border bg-success-soft text-success-strong",
  VES: "border-info-border bg-info-soft text-info-strong",
  COP: "border-warning-border bg-warning-soft text-warning-strong",
};
const MONEDA_POR_DEFECTO = "border-border bg-muted text-muted-foreground";

function infoTipo(tipo?: string) {
  return (tipo && TIPOS[tipo.toLowerCase()]) || TIPO_POR_DEFECTO;
}

function claseMoneda(codigo?: string | null) {
  const cod = (codigo || "").toUpperCase();
  return (cod && MONEDAS[cod]) || MONEDA_POR_DEFECTO;
}

/** Orden de monedas en los selectores: COP, luego VES, luego USD. */
const ORDEN_MONEDAS = ["COP", "VES", "USD"];

/**
 * Ordena una lista de métodos de pago agrupando por moneda en el orden
 * COP → VES → USD (cualquier otra moneda al final, por nombre). Dentro de
 * cada grupo se conserva el orden original de los métodos.
 */
export function ordenarMetodosPorMoneda<T extends { moneda_codigo?: string | null }>(
  metodos: T[]
): T[] {
  const rango = (cod: string | null | undefined) => {
    const i = ORDEN_MONEDAS.indexOf((cod || "").trim().toUpperCase());
    return i === -1 ? ORDEN_MONEDAS.length : i;
  };
  const codigoDe = (m: T) => m?.moneda_codigo || "";
  return [...metodos].sort((a, b) => {
    const d = rango(codigoDe(a)) - rango(codigoDe(b));
    return d !== 0 ? d : codigoDe(a).localeCompare(codigoDe(b));
  });
}

/** "Efectivo USD" → "Efectivo" cuando el nombre ya lleva la moneda al final. */
function etiquetaDe(m: MetodoPagoOption) {
  const cod = (m.moneda_codigo || "").trim();
  if (cod && m.nombre.toUpperCase().endsWith(` ${cod.toUpperCase()}`)) {
    return m.nombre.slice(0, -(cod.length + 1));
  }
  return m.nombre;
}

export function MetodoPagoSelect({
  metodos,
  value,
  onChange,
  placeholder = "Seleccionar método...",
  allowEmptyLabel,
  className,
  triggerClassName,
  disabled = false,
  ariaLabel,
}: MetodoPagoSelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const valorStr = value === null || value === undefined ? "" : String(value);
  const seleccionado = metodos.find((m) => String(m.id) === valorStr);
  const InfoSel = infoTipo(seleccionado?.tipo);

  // Agrupa los métodos por moneda (COP, VES, USD…), en ese orden
  const grupos: { codigo: string; items: MetodoPagoOption[] }[] = [];
  for (const m of ordenarMetodosPorMoneda(metodos)) {
    const codigo = (m.moneda_codigo || "").trim().toUpperCase();
    const g = grupos.find((x) => x.codigo === codigo);
    if (g) g.items.push(m);
    else grupos.push({ codigo, items: [m] });
  }

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const flip = spaceBelow < MAX_HEIGHT + GAP && rect.top > spaceBelow;
    const available = flip ? rect.top - GAP : spaceBelow;
    const height = Math.min(MAX_HEIGHT, Math.max(0, available - GAP));
    setPosition({
      top: flip ? rect.top - height - GAP : rect.bottom + GAP,
      left: rect.left,
      width: rect.width,
      height,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handleSelect = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const dropdown = open && position ? (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.height,
          }}
          className="fixed z-[200] flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          role="listbox"
          aria-label={ariaLabel}
        >
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {allowEmptyLabel !== undefined && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-muted",
                  !valorStr && "bg-muted font-medium"
                )}
                role="option"
                aria-selected={!valorStr}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Wallet size={14} />
                </span>
                <span className="flex-1 truncate text-muted-foreground">{allowEmptyLabel}</span>
                {!valorStr && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            )}

            {grupos.map((g) => (
              <div key={g.codigo || "sin-moneda"}>
                {g.codigo && (
                  <div className="sticky top-0 z-10 bg-card px-3 pb-1 pt-2">
                    <span
                      className={cn(
                        "inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-bold leading-none",
                        claseMoneda(g.codigo)
                      )}
                    >
                      {g.codigo}
                    </span>
                  </div>
                )}
                {g.items.map((m) => {
                  const activo = String(m.id) === valorStr;
                  const Info = infoTipo(m.tipo);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelect(m.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-muted",
                        activo && "bg-primary/10 font-semibold text-primary"
                      )}
                      role="option"
                      aria-selected={activo}
                    >
                      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", Info.color)}>
                        <Info.icono size={14} />
                      </span>
                      <span className="flex-1 truncate">{etiquetaDe(m)}</span>
                      {activo && <Check size={14} className="shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ))}

            {metodos.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Sin métodos de pago disponibles
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  ) : null;

  return (
    <div ref={rootRef} className={cn("relative inline-flex h-10", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex h-full w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-sm text-left transition-colors",
          open ? "border-primary ring-1 ring-ring" : "hover:border-primary/50",
          disabled && "cursor-not-allowed opacity-60",
          triggerClassName
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {seleccionado && (
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", InfoSel.color)}>
              <InfoSel.icono size={14} />
            </span>
          )}
          <span className={cn("truncate", !seleccionado && "text-muted-foreground")}>
            {seleccionado ? etiquetaDe(seleccionado) : placeholder}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {seleccionado?.moneda_codigo && (
            <span
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[10px] font-bold leading-none",
                claseMoneda(seleccionado.moneda_codigo)
              )}
            >
              {seleccionado.moneda_codigo.toUpperCase()}
            </span>
          )}
          <ChevronDown
            size={14}
            className={cn("text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </div>
  );
}
