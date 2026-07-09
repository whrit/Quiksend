import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Buttons — utility-first. The default is filled ink for primary intent; the
 * outline is a hairline card for secondary. Neither carries any brand hue —
 * the design system has no brand accent. Destructive uses status red only
 * when the action is genuinely destructive.
 *
 * `ink` is the one product-specific variant, reserved for human-authored
 * actions (Send reply, Save draft, manual override). It reads as a
 * fountain-pen mark and differentiates human intent from system-generated
 * states — the design system's one product-specific decision.
 *
 * `accent` is kept as a backwards-compat alias for `default` while callsites
 * migrate; delete after the sweep.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none",
    "rounded-[4px] font-medium tracking-[-0.005em]",
    "transition-[background-color,color,border-color,box-shadow] duration-[120ms] ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:shrink-0 [&_svg]:size-3.5",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[color:var(--paper-800)] active:bg-[color:var(--paper-950)]",
        accent:
          "bg-primary text-primary-foreground hover:bg-[color:var(--paper-800)] active:bg-[color:var(--paper-950)]",
        ink: "bg-[color:var(--ink-red-600)] text-white hover:bg-[color:var(--ink-red-700)] active:bg-[color:var(--ink-red-700)]",
        outline:
          "bg-card text-foreground border border-border hover:bg-[color:var(--paper-050)] hover:border-[color:var(--paper-300)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[color:var(--paper-150)]",
        ghost:
          "text-foreground hover:bg-[color:var(--paper-100)] data-[state=open]:bg-[color:var(--paper-100)]",
        destructive: "bg-destructive text-white hover:brightness-[1.05]",
        link: "text-[color:var(--link)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-7 px-2.5 text-[0.75rem]",
        sm: "h-6 px-2 text-[0.6875rem] rounded-[3px]",
        lg: "h-9 px-4 text-[0.8125rem]",
        icon: "h-7 w-7",
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
