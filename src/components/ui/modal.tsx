"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  hideCloseButton?: boolean;
  /**
   * z-index base del modal (overlay = base, contenido = base + 1). Súbelo en los
   * modales ANIDADOS: con el valor por defecto (100) el contenido del modal
   * padre queda por encima del overlay del hijo, así que el fondo no se
   * atenúa ni se desenfoca.
   */
  zIndex?: number;
  /** Clases extra del overlay (fondo, desenfoque). */
  overlayClassName?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  hideCloseButton,
  zIndex = 100,
  overlayClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    // Se guarda el estado anterior para no romper el scroll cuando se
    // cierra un modal anidado (el modal padre sigue abierto).
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ zIndex: zIndex }}
            className={cn("fixed inset-0 bg-background/80 backdrop-blur-sm", overlayClassName)}
          />
          <div
            style={{ zIndex: zIndex + 1 }}
            className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 pointer-events-none"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
              className={cn(
                "w-full max-w-lg overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl pointer-events-auto flex flex-col max-h-[90vh]",
                className
              )}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-6 py-4">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
                {!hideCloseButton && (
                  <button
                    onClick={onClose}
                    className="rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="space-y-4 px-6 py-5 overflow-y-auto flex-1 min-h-0">{children}</div>
              {footer && (
                <div className="flex shrink-0 gap-3 border-t border-border/60 px-6 py-4">{footer}</div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
