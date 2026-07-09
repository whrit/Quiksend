import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Buttons — the most touched primitive. Every choice here reverberates across
 * hundreds of surfaces. Rules of thumb:
 *   • Default = solid ink for primary intent (create, save, activate).
 *   • Accent  = burnt amber, reserved for the ONE hero action per page.
 *   • Outline = paper card w/ hairline rule, used for secondary intent.
 *   • Ghost   = zero-chrome, for tertiary + destructive-ish actions.
 * All sizes carry -0.005em tracking to compensate for General Sans's slightly
 * open apertures at small sizes.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none",
    "rounded-[6px] font-medium tracking-[-0.005em]",
    "transition-[background-color,color,box-shadow,transform] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:translate-y-[0.5px]",
    "[&_svg]:shrink-0 [&_svg]:size-3.5",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_-1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(20,15,5,0.15)] hover:bg-primary/92",
        accent:
          "bg-accent text-accent-foreground shadow-[inset_0_-1px_0_rgba(0,0,0,0.08),0_1px_2px_rgba(140,80,20,0.18)] hover:brightness-[1.04]",
        outline:
          "bg-card text-foreground border border-border shadow-[0_1px_0_rgba(20,15,5,0.02)] hover:bg-secondary hover:border-[color:var(--ink-300)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[color:var(--ink-200)]/70",
        ghost:
          "text-foreground hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary",
        destructive:
          "bg-destructive text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(160,30,20,0.22)] hover:brightness-[1.05]",
        link: "text-foreground underline-offset-4 hover:underline decoration-[color:var(--ink-300)]",
      },
      size: {
        default: "h-8 px-3 text-[0.8125rem]",
        sm: "h-7 px-2.5 text-[0.75rem] rounded-[5px]",
        lg: "h-10 px-5 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
