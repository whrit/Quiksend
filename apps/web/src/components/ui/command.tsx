import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const Command = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) => (
  <CommandPrimitive
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-popover text-popover-foreground",
      className,
    )}
    {...props}
  />
);

export const CommandInput = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) => (
  <div className="flex items-center gap-2 border-b border-border px-4">
    <Search className="h-4 w-4 shrink-0 text-[color:var(--ink-400)]" />
    <CommandPrimitive.Input
      className={cn(
        "flex h-12 w-full rounded-md bg-transparent py-3 text-[0.9375rem] tracking-[-0.01em] outline-none",
        "placeholder:text-[color:var(--ink-400)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
);

export const CommandList = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List
    className={cn("max-h-[360px] overflow-y-auto overflow-x-hidden px-1.5 py-1.5", className)}
    {...props}
  />
);

export const CommandEmpty = (props: React.ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty
    className="py-10 text-center text-[0.8125rem] text-muted-foreground"
    {...props}
  />
);

export const CommandGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    className={cn(
      "overflow-hidden py-1 text-foreground",
      "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1",
      "[&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-medium",
      "[&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:uppercase",
      "[&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export const CommandSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) => (
  <CommandPrimitive.Separator className={cn("mx-1 my-1 h-px bg-border", className)} {...props} />
);

export const CommandItem = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    className={cn(
      "relative flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8125rem] outline-none",
      "aria-selected:bg-[color:var(--ink-100)] aria-selected:text-foreground",
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      "[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-[color:var(--ink-500)]",
      "aria-selected:[&_svg]:text-[color:var(--amber-600)]",
      className,
    )}
    {...props}
  />
);
