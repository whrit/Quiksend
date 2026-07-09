import { Toaster as SonnerToaster, toast } from "sonner";
import type * as React from "react";

export type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

export const Toaster = ({ ...props }: ToasterProps) => (
  <SonnerToaster
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--card)",
        "--normal-border": "var(--border)",
        "--normal-text": "var(--foreground)",
        fontFamily: "var(--font-sans)",
      } as React.CSSProperties
    }
    toastOptions={{
      classNames: {
        toast:
          "group toast text-[0.75rem] tracking-[-0.005em] rounded-[5px] shadow-[0_10px_30px_-8px_rgba(20,15,10,0.15),0_0_0_1px_var(--border)]",
        description: "text-[0.6875rem] text-[color:var(--muted-foreground)]",
        actionButton:
          "!bg-foreground !text-background !rounded-[3px] !text-[0.6875rem] !font-medium",
        cancelButton: "!bg-secondary !text-secondary-foreground !rounded-[3px] !text-[0.6875rem]",
      },
    }}
    {...props}
  />
);

export { toast };
