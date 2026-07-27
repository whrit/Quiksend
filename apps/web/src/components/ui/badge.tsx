import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Badge — the metadata pill.
 *
 * Fully rounded on purpose: pills are metadata, buttons are actions, and the
 * two shapes must never blur. Previously these were 3px-radius rectangles, so
 * a status chip and a small button were indistinguishable at a glance.
 *
 * Every tinted variant derives its text from the hue mixed toward ink rather
 * than using the pure hue, which fails contrast on its own tint (~1.9:1).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 h-[22px] rounded-full px-2 text-[0.6875rem] font-[550] leading-none tabular whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        subtle: "bg-[color:var(--paper-100)] text-[color:var(--paper-600)]",
        secondary: "bg-[color:var(--paper-100)] text-[color:var(--paper-600)]",
        outline: "border border-border text-[color:var(--paper-600)]",
        success: "bg-[color:var(--status-green-050)] text-[color:var(--status-green-600)]",
        destructive: "bg-[color:var(--status-red-050)] text-[color:var(--status-red-600)]",
        warning: "bg-[color:var(--status-yellow-050)] text-[color:var(--status-yellow-600)]",
        info: "bg-[color:var(--brand-tint)] text-[color:var(--brand-700)]",
        brand: "bg-[color:var(--brand-tint)] text-[color:var(--brand-700)]",
        ink: "bg-[color:var(--ink-red-100)] text-[color:var(--ink-red-700)]",
        accent: "bg-[color:var(--paper-100)] text-[color:var(--paper-600)]",
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
