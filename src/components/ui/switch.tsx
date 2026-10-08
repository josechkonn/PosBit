"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Switch({ defaultChecked = false, checked: controlledChecked, onCheckedChange, disabled, ...props }: SwitchProps) {
  const [checked, setChecked] = useState(defaultChecked);
  const isControlled = controlledChecked !== undefined;

  useEffect(() => {
    if (isControlled) {
      setChecked(controlledChecked);
    }
  }, [controlledChecked, isControlled]);

  const currentChecked = isControlled ? controlledChecked : checked;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={currentChecked}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        const next = !currentChecked;
        if (!isControlled) setChecked(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        "flex h-5 w-10 items-center rounded-full px-0.5 transition-colors",
        currentChecked ? "justify-end bg-primary" : "justify-start bg-muted",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
      )}
      {...props}
    >
      <span className="h-4 w-4 rounded-full bg-white shadow" />
    </button>
  );
}
