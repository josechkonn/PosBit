"use client";

import { motion } from "framer-motion";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* ── Panel de marca (izquierda) ─────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative hidden w-1/2 items-center justify-center overflow-hidden bg-sidebar lg:flex"
      >
        {/* Patrón de líneas tipo manifiesto */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 47px, #ffffff 47px, #ffffff 48px)",
          }}
        />

        {/* Círculo decorativo sutil */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-primary/5 blur-2xl" />

        {/* Contenido */}
        <div className="relative z-10 flex max-w-sm flex-col items-center text-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mb-2 text-2xl font-bold tracking-tight text-white"
          >
            PosBit
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-sidebar-foreground/60"
          >
            Sistema de Inventario
          </motion.p>
        </div>
      </motion.div>

      {/* ── Panel de formulario (derecha) ───────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full items-center justify-center bg-background p-6 lg:w-1/2"
      >
        <div className="w-full max-w-sm">
          {/* Marca móvil */}
          <div className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
            <div>
              <div className="text-base font-bold leading-tight text-foreground">
                PosBit
              </div>
              <div className="text-[10px] leading-tight text-muted-foreground">
                Sistema de Inventario
              </div>
            </div>
          </div>

          {children}
        </div>
      </motion.div>
    </div>
  );
}
