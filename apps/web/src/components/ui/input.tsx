import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input — sits in the paper like a printed field. A soft inset shadow gives
 * the well depth; the amber focus ring signals active input without shouting.
 * Tabular numbers come from the global base style so metric fields don't jitter.
 */
export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full rounded-[6px] border border-input bg-card px-2.5 py-1 text-[0.8125rem]",
        "shadow-[inset_0_1px_1px_rgba(20,15,5,0.03)] transition-[box-shadow,border-color] duration-150",
        "placeholder:text-[color:var(--ink-400)] placeholder:font-normal",
        "hover:border-[color:var(--ink-300)]",
        "focus-visible:outline-none focus-visible:border-[color:var(--amber-600)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--amber-100)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
