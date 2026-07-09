import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Badge — status pill. Uses the semantic status colors (green, red, blue,
 * yellow) intentionally: color always carries meaning, never decoration.
 * `ink` marks human-authored artifacts. `secondary`/`subtle` = neutral chip.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[0.6875rem] font-medium tabular tracking-[0.005em]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        subtle: "bg-[color:var(--paper-100)] text-foreground",
        secondary: "bg-[color:var(--paper-100)] text-foreground",
        outline: "border border-border text-foreground",
        success: "bg-[color:var(--status-green-050)] text-[color:var(--status-green-600)]",
        destructive: "bg-[color:var(--status-red-050)] text-[color:var(--status-red-600)]",
        warning: "bg-[color:var(--status-yellow-050)] text-[color:var(--status-yellow-600)]",
        info: "bg-[color:var(--status-blue-050)] text-[color:var(--status-blue-600)]",
        ink: "bg-[color:var(--ink-red-100)] text-[color:var(--ink-red-700)]",
        // Backwards-compat alias for the old `accent` variant during migration.
        accent: "bg-[color:var(--paper-100)] text-foreground",
      },
    },
    defaultVariants: { variant: "subtle" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
