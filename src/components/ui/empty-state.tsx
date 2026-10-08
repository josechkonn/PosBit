import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  className?: string;
}

export function EmptyState({ icon: Icon, message, className }: EmptyStateProps) {
  return (
    <div className={cn("flex h-48 flex-col items-center justify-center text-muted-foreground", className)}>
      <Icon size={28} className="mb-2 opacity-30" />
      <span className="text-sm">{message}</span>
    </div>
  );
}
