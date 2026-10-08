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
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  hideCloseButton,
}: ModalProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "unset";
    return () => {
      document.body.style.overflow = "unset";
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
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 sm:p-6 pointer-events-none">
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
