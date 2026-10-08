"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 font-medium transition-[box-shadow,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary-600 hover:shadow-lg hover:shadow-primary/30 active:shadow-sm",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-primary-100 active:bg-primary-200",
        outline:
          "border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground hover:border-primary/30 active:bg-accent/70",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/70",
        destructive:
          "text-muted-foreground hover:bg-danger-soft hover:text-danger active:bg-danger-soft/70",
      },
      size: {
        sm: "px-3 py-1.5 text-xs",
        md: "px-4 py-2 text-sm",
        lg: "px-6 py-2.5 text-base",
        icon: "p-1.5",
        "icon-lg": "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  animate?: boolean;
}

export function Button({
  className,
  variant,
  size,
  type = "button",
  animate = true,
  ...props
}: ButtonProps) {
  const MotionButton = motion.button;

  return (
    <MotionButton
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      whileHover={animate ? { scale: 1.02, y: -1 } : undefined}
      whileTap={animate ? { scale: 0.97, y: 0 } : undefined}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 17,
      }}
      {...(props as any)}
    />
  );
}

export { buttonVariants };
