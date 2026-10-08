import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold leading-tight",
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
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  label: string;
}

export function Badge({ label, variant, className, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
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

export function StatusBadge({ status }: { status: string }) {
  return <Badge label={status} variant={statusMap[status] ?? "neutral"} />;
}
