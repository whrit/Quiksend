import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Badge — status indicator + label. Smaller than shadcn default, tabular so
 * numeric badges (counts, percentages) line up. `subtle` and `accent` are the
 * signature variants; `outline` for the quiet case; `secondary` is kept as an
 * alias to `subtle` for backward-compat with existing callsites.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[0.6875rem] font-medium tabular tracking-[0.005em] transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        subtle: "bg-secondary text-secondary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        accent: "bg-[color:var(--accent-soft)] text-[color:var(--amber-600)]",
        outline: "border border-border text-foreground",
        success: "bg-[color:var(--success)]/12 text-[color:var(--success)]",
        destructive: "bg-destructive/12 text-destructive",
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
