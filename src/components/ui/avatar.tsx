import { cn } from "@/lib/utils";

const sizes = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-[11px]",
  lg: "h-14 w-14 text-lg",
} as const;

interface AvatarProps {
  initials: string;
  size?: keyof typeof sizes;
  className?: string;
}

export function Avatar({ initials, size = "md", className }: AvatarProps) {
  return (
    <div
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded bg-primary/90 font-bold text-primary-foreground",
        sizes[size],
        className
      )}
    >
      {initials}
    </div>
  );
}
