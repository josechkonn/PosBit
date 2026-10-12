"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxMultiProps {
  options: ComboboxOption[];
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
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
const MAX_HEIGHT = 240;

/**
 * Combobox multi-selección con buscador: hace clic para marcar/desmarcar
 * opciones (el menú permanece abierto) y muestra la selección como chips
 * removibles. Útil para seleccionar varios proveedores/categorías, etc.
 */
export function ComboboxMulti({
  options,
  value,
  onChange,
  placeholder = "Buscar...",
  emptyLabel = "Sin resultados",
  className,
  disabled = false,
}: ComboboxMultiProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedMap = useMemo(() => new Map(value.map((v) => [v, true])), [value]);

  const cleanSearch = search.toLowerCase().replace(/[^a-z0-9]/g, "");
  const filtered = options.filter((o) => {
    const rawMatch = o.label.toLowerCase().includes(search.toLowerCase());
    if (rawMatch) return true;
    if (cleanSearch.length > 0) {
      const cleanLabel = o.label.toLowerCase().replace(/[^a-z0-9]/g, "");
      return cleanLabel.includes(cleanSearch);
    }
    return false;
  });

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

  const toggle = (optionValue: string) => {
    if (selectedMap.has(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
    setSearch("");
  };

  const remove = (optionValue: string) => {
    onChange(value.filter((v) => v !== optionValue));
  };

  const dropdown = open && position ? (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.height,
          }}
          className="fixed z-[200] flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          {/* Search */}
          <div className="shrink-0 border-b border-border/60 p-2">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
          </div>

          {/* Options */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {emptyLabel}
              </div>
            ) : (
              filtered.map((option) => {
                const activo = selectedMap.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggle(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors hover:bg-muted",
                      activo && "bg-primary/5 font-medium text-foreground"
                    )}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                        activo
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border"
                      )}
                    >
                      {activo && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer: selección en vivo (visible mientras se agregan/quitan) */}
          {value.length > 0 && (
            <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <span>
                {value.length} {value.length === 1 ? "seleccionado" : "seleccionados"}
              </span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="font-medium text-primary hover:underline"
              >
                Quitar todos
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  ) : null;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded border border-border bg-background px-3 text-sm text-left transition-colors",
          open ? "border-primary ring-1 ring-ring" : "hover:border-primary/50",
          value.length === 0 && "text-muted-foreground",
          disabled && "opacity-60 cursor-not-allowed bg-muted"
        )}
      >
        <span className="truncate">
          {value.length === 0
            ? placeholder
            : `${value.length} ${value.length === 1 ? "seleccionado" : "seleccionados"}`}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((v) => {
            const opt = options.find((o) => o.value === v);
            if (!opt) return null;
            return (
              <span
                key={v}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 py-1 pl-3 pr-1.5 text-sm font-medium text-primary"
              >
                <span className="truncate">{opt.label}</span>
                <button
                  type="button"
                  onClick={() => !disabled && remove(v)}
                  title={`Quitar ${opt.label}`}
                  aria-label={`Quitar ${opt.label}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-primary/70 transition-colors hover:bg-primary/20 hover:text-primary"
                >
                  <X size={13} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </div>
  );
}