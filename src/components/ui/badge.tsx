import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap leading-tight",
  {
    variants: {
      variant: {
        success: "bg-success-soft text-success-strong ring-1 ring-inset ring-success-border",
        warning: "bg-warning-soft text-warning-strong ring-1 ring-inset ring-warning-border",
        danger: "bg-danger-soft text-danger-strong ring-1 ring-inset ring-danger-border",
        info: "bg-info-soft text-info-strong ring-1 ring-inset ring-info-border",
        purple: "bg-purple-soft text-purple-strong ring-1 ring-inset ring-purple-border",
        neutral: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
      },
      size: {
        /** Compacto (por defecto): tablas y badges dentro de párrafos. */
        sm: "rounded px-2 py-0.5 text-[11px] font-semibold",
        /** Píldora: misma forma y tamaño que los botones de acción de las tablas. */
        pill: "gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-sm",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "sm",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  label: string;
  /** Ícono opcional a la izquierda del texto (útil con `size="pill"`). */
  icon?: React.ReactNode;
}

export function Badge({ label, variant, size, icon, className, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {icon}
      {label}
    </span>
  );
}

/* ─── Badge de estado: mapea los estados de negocio a variantes ───── */
const statusMap: Record<string, NonNullable<BadgeProps["variant"]>> = {
  Activo: "success",
  Inactivo: "neutral",
  Recibida: "success",
  Pagada: "success",
  Pendiente: "warning",
  "En Tránsito": "info",
  Cancelada: "danger",
  Anulada: "danger",
  "Bajo Existencias": "warning",
  "Sin Existencias": "danger",
  Ajuste: "purple",
  Entrada: "success",
  Salida: "danger",
  Crédito: "info",
  Contado: "neutral",
  Parcial: "warning",
  Procesado: "success",
  "Persona Natural": "info",
  Empresa: "purple",
  "Retorno Cliente": "info",
  "Devolución Prov.": "purple",
};

export function StatusBadge({
  status,
  size,
  icon,
}: {
  status: string;
  size?: NonNullable<BadgeProps["size"]>;
  icon?: React.ReactNode;
}) {
  return <Badge label={status} variant={statusMap[status] ?? "neutral"} size={size} icon={icon} />;
}
