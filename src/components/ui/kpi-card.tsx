"use client";

import { useEffect, useRef } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Package,
  ShoppingCart,
  TrendingUp,
  Truck,
} from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "./card";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ComponentType<{ size: number; className?: string }>> = {
  TrendingUp,
  ShoppingCart,
  Package,
  Truck,
};

/**
 * Ajusta el tamaño de fuente para que un valor largo (p. ej. montos en COP)
 * quepa en el ancho del cuadro sin desbordarse. Empieza en 30px y reduce
 * hasta que entra; si llega al mínimo, recorta con overflow.
 */
function FitValue({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const MAX = 30;
    const MIN = 13;

    const fit = () => {
      let size = MAX;
      el.style.fontSize = `${size}px`;
      let guard = 0;
      while (el.scrollWidth > el.clientWidth && size > MIN && guard++ < 60) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();

    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [children]);

  return (
    <div ref={ref} className={cn("overflow-hidden whitespace-nowrap", className)}>
      {children}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  icon: keyof typeof iconMap | React.ComponentType<{ size: number; className?: string }>;
  trend?: string;
  trendUp?: boolean;
  className?: string;
  delay?: number;
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  trend,
  trendUp,
  className,
  delay = 0,
}: KpiCardProps) {
  const Icon = typeof icon === "string" ? (iconMap[icon] ?? Package) : icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.45,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="min-w-0"
    >
      <Card className={cn("flex min-w-0 flex-col gap-3 p-5 hover-lift", className)}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </span>
          <motion.div
            whileHover={{ rotate: 8, scale: 1.1 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
            className="flex h-8 w-8 items-center justify-center rounded bg-primary/10"
          >
            <Icon size={14} className="text-primary" />
          </motion.div>
        </div>
        <div className="min-w-0">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: delay + 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="min-w-0"
          >
            <FitValue className="font-mono text-3xl font-bold tracking-tight text-foreground">
              {value}
            </FitValue>
          </motion.div>
          <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
        </div>
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              trendUp ? "text-success" : "text-danger"
            )}
          >
            {trendUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {trend}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
