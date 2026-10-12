"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComboboxCreatableOption {
  value: string;
  label: string;
}

interface ComboboxCreatableProps {
  options: ComboboxCreatableOption[];
  /** Texto actual (el nombre en edición). Al elegir/confirmar se emite aquí. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  /** Label del botón "crear" con texto libre. `%s` se reemplaza por el texto. */
  creatableLabel?: string;
  creatable?: boolean;
  className?: string;
  disabled?: boolean;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 6;
const MAX_HEIGHT = 220;

/**
 * Combobox con búsqueda Y texto libre ("creatable"): escribe para filtrar las
 * sugerencias; si lo que escribes no coincide con ninguna, aparece la opción
 * "Usar «texto»" que permite crear un valor nuevo. Usado para nombres de
 * presentaciones (Caja, Bolsa, Paquete...).
 */
export function ComboboxCreatable({
  options,
  value,
  onChange,
  placeholder = "Buscar...",
  emptyLabel = "Sin resultados",
  creatableLabel = "Usar «%s»",
  creatable = true,
  className,
  disabled = false,
}: ComboboxCreatableProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Búsqueda sobre el texto actual (el input ES la búsqueda).
  const clean = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const cleanQuery = clean(value);
  const filtered = options.filter((o) => {
    if (o.label.toLowerCase().includes(value.toLowerCase())) return true;
    return cleanQuery.length > 0 && clean(o.label).includes(cleanQuery);
  });
  const exactMatch = options.some(
    (o) => o.label.trim().toLowerCase() === value.trim().toLowerCase()
  );
  const mostrarCrear = creatable && !disabled && value.trim().length > 0 && !exactMatch;

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
      if (
        rootRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
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

  const commit = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onChange("");
      setOpen(true);
    }
  };

  const handleEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (mostrarCrear) commit(value.trim());
    else if (filtered.length > 0) commit(filtered[0].label);
    else setOpen(false);
  };

  const crearEtiqueta = () => {
    const t = value.trim();
    const base = creatableLabel.includes("%s") ? creatableLabel : `Usar «%s»`;
    return base.replace("%s", t);
  };

  const dropdown = open && position ? (
    <motion.div
      ref={dropdownRef}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15 }}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.height }}
      className="fixed z-[200] flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && !mostrarCrear ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => commit(option.label)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-muted",
                option.label.trim().toLowerCase() === value.trim().toLowerCase() && "bg-muted font-medium"
              )}
            >
              {option.label.trim().toLowerCase() === value.trim().toLowerCase() && (
                <Check size={13} className="text-primary flex-shrink-0" />
              )}
              <span className="truncate">{option.label}</span>
            </button>
          ))
        )}
      </div>

      {mostrarCrear && (
        <button
          type="button"
          onClick={() => commit(value.trim())}
          className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2.5 text-sm text-left text-primary transition-colors hover:bg-primary/5"
        >
          <Plus size={14} className="flex-shrink-0" />
          <span className="truncate">{crearEtiqueta()}</span>
        </button>
      )}
    </motion.div>
  ) : null;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
        />
        <input
          ref={triggerRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleEnter}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center rounded border border-border bg-background pl-8 pr-9 text-sm text-left transition-colors",
            open ? "border-primary ring-1 ring-ring" : "hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring",
            !value && "text-muted-foreground",
            disabled && "opacity-60 cursor-not-allowed bg-muted"
          )}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              tabIndex={-1}
            >
              <X size={13} />
            </button>
          )}
          <ChevronDown
            size={14}
            className={cn("text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(<AnimatePresence>{dropdown}</AnimatePresence>, document.body)}
    </div>
  );
}