import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatVariant = "success" | "danger" | "purple" | "info";

const variantStyles: Record<
  StatVariant,
  { card: string; box: string; icon: string; label: string; value: string }
> = {
  success: {
    card: "border-success-border bg-success-soft",
    box: "bg-success/15",
    icon: "text-success",
    label: "text-success",
    value: "text-success-strong",
  },
  danger: {
    card: "border-danger-border bg-danger-soft",
    box: "bg-danger/15",
    icon: "text-danger",
    label: "text-danger",
    value: "text-danger-strong",
  },
  purple: {
    card: "border-purple-border bg-purple-soft",
    box: "bg-purple/15",
    icon: "text-purple-strong",
    label: "text-purple-strong",
    value: "text-purple-strong",
  },
  info: {
    card: "border-info-border bg-info-soft",
    box: "bg-info/15",
    icon: "text-info",
    label: "text-info",
    value: "text-info-strong",
  },
};

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  variant: StatVariant;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, variant, className }: StatCardProps) {
  const s = variantStyles[variant];
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-3.5", s.card, className)}>
      <div className={cn("flex h-9 w-9 items-center justify-center rounded", s.box)}>
        <Icon size={16} className={s.icon} />
      </div>
      <div>
        <div className={cn("text-[11px] font-semibold uppercase tracking-wide", s.label)}>{label}</div>
        <div className={cn("font-mono text-lg font-bold", s.value)}>{value}</div>
      </div>
    </div>
  );
}
