import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

export function SearchBar({ containerClassName, className, ...props }: SearchBarProps) {
  return (
    <div className={cn("relative", containerClassName)}>
      <Search
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
      />
      <input
        type="text"
        className={cn(
          "w-64 rounded border border-border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring",
          className
        )}
        {...props}
      />
    </div>
  );
}
