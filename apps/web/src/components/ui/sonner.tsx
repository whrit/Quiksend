import { Toaster as SonnerToaster, toast } from "sonner";
import type * as React from "react";

export type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * Toast surface — same paper card treatment as the app, so notifications feel
 * like slips of paper being handed to the user rather than platform-native
 * banners.
 */
export const Toaster = ({ ...props }: ToasterProps) => (
  <SonnerToaster
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--card)",
        "--normal-border": "var(--border)",
        "--normal-text": "var(--foreground)",
        "--success-bg": "var(--card)",
        "--success-border": "var(--border)",
        "--success-text": "var(--foreground)",
        "--error-bg": "var(--card)",
        "--error-border": "var(--border)",
        "--error-text": "var(--foreground)",
        fontFamily: "var(--font-sans)",
      } as React.CSSProperties
    }
    toastOptions={{
      classNames: {
        toast:
          "group toast text-[0.8125rem] tracking-[-0.005em] rounded-[8px] shadow-[0_10px_30px_-8px_rgba(20,15,5,0.15),0_0_0_1px_var(--border)]",
        description: "text-[0.75rem] text-[color:var(--muted-foreground)]",
        actionButton: "!bg-foreground !text-background !rounded-[5px] !text-[0.75rem] !font-medium",
        cancelButton: "!bg-secondary !text-secondary-foreground !rounded-[5px] !text-[0.75rem]",
      },
    }}
    {...props}
  />
);

export { toast };
