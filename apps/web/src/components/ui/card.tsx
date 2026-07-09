import type * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Card — hairline-bordered container. No shadow tiers, no paper metaphor.
 * Elevates through the border alone. When you need real elevation (dialogs,
 * popovers), reach for the dialog / popover primitives.
 */
export function Card({ className, ...props }: DivProps) {
  return <div className={cn("panel", className)} {...props} />;
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-0.5 px-4 pt-3.5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        "text-[0.8125rem] font-semibold leading-tight tracking-[-0.01em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("text-[0.75rem] text-muted-foreground leading-relaxed", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("flex items-center gap-2 px-4 pb-3.5 pt-3 border-t border-border", className)}
      {...props}
    />
  );
}
