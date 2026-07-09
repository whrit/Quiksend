import type * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Card — the "paper" surface. Sits atop the cream background with a hairline
 * rule and micro-shadow so pages feel like stacked broadsheet sections. Title
 * defaults to General Sans; for editorial big-number moments, use `font-display`
 * inline where the writer wants the serif.
 */
export function Card({ className, ...props }: DivProps) {
  return <div className={cn("paper", className)} {...props} />;
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-1 px-5 pt-5 pb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        "text-[0.9375rem] font-semibold leading-tight tracking-[-0.015em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("text-[0.8125rem] text-muted-foreground leading-relaxed", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("flex items-center px-5 pb-5 pt-4 border-t border-border", className)}
      {...props}
    />
  );
}
