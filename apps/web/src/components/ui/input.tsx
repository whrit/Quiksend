import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input — hairline field. Neutral focus ring (no amber tint). Tabular
 * numerals come from the global body style so metric inputs align.
 */
export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-7 w-full rounded-[4px] border border-input bg-card px-2 text-[0.75rem]",
        "transition-[border-color,box-shadow] duration-120",
        "placeholder:text-[color:var(--paper-400)]",
        "hover:border-[color:var(--paper-300)]",
        "focus-visible:outline-none focus-visible:border-[color:var(--paper-500)] focus-visible:ring-2 focus-visible:ring-[color:var(--paper-100)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
