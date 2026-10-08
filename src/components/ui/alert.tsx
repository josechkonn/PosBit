import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex items-start gap-2.5 rounded border px-3 py-2.5 text-sm",
  {
    variants: {
      variant: {
        danger: "border-danger-border bg-danger-soft text-danger-strong",
        warning: "border-warning-border bg-warning-soft text-warning-strong",
        success: "border-success-border bg-success-soft text-success-strong",
        info: "border-info-border bg-info-soft text-info-strong",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

const alertIcons: Record<string, LucideIcon> = {
  danger: AlertCircle,
  warning: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ variant = "info", className, children, ...props }: AlertProps) {
  const Icon = alertIcons[variant ?? "info"];
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon size={15} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}
