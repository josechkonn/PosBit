"use client";

import { cn } from "@/lib/utils";

export function Card({
  className,
  accent,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { accent?: boolean }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card",
        className
      )}
      {...props}
    >
      {accent && <span className="absolute left-0 right-0 top-0 h-[3px] bg-primary" />}
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3.5", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 py-4", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex gap-3 border-t border-border/60 px-5 py-3.5", className)}
      {...props}
    >
      {children}
    </div>
  );
}
