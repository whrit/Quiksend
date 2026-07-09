import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  Import,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Mail,
  MailPlus,
  PencilLine,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Users,
  Webhook,
} from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type CommandAction =
  | { type: "navigate"; to: string; label: string; group: string; Icon: LucideIcon; kbd?: string }
  | { type: "action"; run: () => void; label: string; group: string; Icon: LucideIcon };

type LucideIcon = (props: { className?: string }) => React.ReactNode;

const NAV_COMMANDS: CommandAction[] = [
  {
    type: "navigate",
    to: "/dashboard",
    label: "Dashboard",
    group: "Go to",
    Icon: LayoutDashboard,
    kbd: "D",
  },
  { type: "navigate", to: "/prospects", label: "Prospects", group: "Go to", Icon: Users, kbd: "P" },
  {
    type: "navigate",
    to: "/sequences",
    label: "Sequences",
    group: "Go to",
    Icon: ListChecks,
    kbd: "S",
  },
  { type: "navigate", to: "/inbox", label: "Inbox", group: "Go to", Icon: Inbox, kbd: "I" },
  {
    type: "navigate",
    to: "/compose",
    label: "Compose",
    group: "Go to",
    Icon: PencilLine,
    kbd: "C",
  },
  {
    type: "navigate",
    to: "/analytics",
    label: "Analytics",
    group: "Go to",
    Icon: BarChart3,
    kbd: "A",
  },
  {
    type: "navigate",
    to: "/deliverability",
    label: "Deliverability",
    group: "Go to",
    Icon: Shield,
  },
];

const CREATE_COMMANDS: CommandAction[] = [
  { type: "navigate", to: "/sequences/new", label: "New sequence", group: "Create", Icon: Plus },
  {
    type: "navigate",
    to: "/prospects/import",
    label: "Import prospects",
    group: "Create",
    Icon: Import,
  },
  { type: "navigate", to: "/compose", label: "Compose message", group: "Create", Icon: MailPlus },
];

const SETTINGS_COMMANDS: CommandAction[] = [
  {
    type: "navigate",
    to: "/settings/mailboxes",
    label: "Mailboxes",
    group: "Settings",
    Icon: Mail,
  },
  {
    type: "navigate",
    to: "/settings/crm",
    label: "CRM connections",
    group: "Settings",
    Icon: Webhook,
  },
  {
    type: "navigate",
    to: "/settings/webhooks",
    label: "Webhooks",
    group: "Settings",
    Icon: Webhook,
  },
  {
    type: "navigate",
    to: "/settings/api-keys",
    label: "API keys",
    group: "Settings",
    Icon: KeyRound,
  },
  {
    type: "navigate",
    to: "/settings/value-props",
    label: "Value props",
    group: "Settings",
    Icon: Sparkles,
  },
  {
    type: "navigate",
    to: "/settings/deliverability",
    label: "Deliverability",
    group: "Settings",
    Icon: Shield,
  },
  {
    type: "navigate",
    to: "/settings/suppression",
    label: "Suppression list",
    group: "Settings",
    Icon: Settings,
  },
];

/**
 * The ⌘K command palette — one of the signature moments. Groups feel like
 * chapter headings in a broadsheet; icons align to a monospace-ish grid.
 *
 * Trigger from anywhere: Cmd/Ctrl-K, or click the "Search" hint in the sidebar.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const run = (action: CommandAction) => {
    onOpenChange(false);
    if (action.type === "navigate") {
      void navigate({ to: action.to });
    } else {
      action.run();
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    onOpenChange(false);
    await authClient.signOut();
    window.location.assign("/login");
  };

  const groups: [string, CommandAction[]][] = [
    ["Go to", NAV_COMMANDS],
    ["Create", CREATE_COMMANDS],
    ["Settings", SETTINGS_COMMANDS],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[560px] p-0 gap-0 border-0 shadow-[0_20px_60px_-15px_rgba(20,15,5,0.25),0_0_0_1px_var(--border)]"
        showCloseButton={false}
      >
        <Command loop shouldFilter>
          <CommandInput placeholder="Search everything, or type a command…" />
          <CommandList>
            <CommandEmpty>
              <div className="font-display text-[1.375rem] leading-none text-foreground">
                Nothing here.
              </div>
              <div className="mt-1 text-[0.75rem] text-muted-foreground">
                Try “prospects”, “compose”, or a sequence name.
              </div>
            </CommandEmpty>
            {groups.map(([heading, items], idx) => (
              <div key={heading}>
                {idx > 0 && <CommandSeparator />}
                <CommandGroup heading={heading}>
                  {items.map((item) => (
                    <CommandItem
                      key={`${item.group}-${item.label}`}
                      onSelect={() => run(item)}
                      value={`${item.group} ${item.label}`}
                    >
                      <item.Icon />
                      <span className="flex-1">{item.label}</span>
                      {"kbd" in item && item.kbd && (
                        <span className="flex items-center gap-1 text-[color:var(--ink-400)]">
                          <span className="kbd">G</span>
                          <span className="kbd">{item.kbd}</span>
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ))}
            <CommandSeparator />
            <CommandGroup heading="Session">
              <CommandItem onSelect={() => void signOut()} disabled={signingOut}>
                <Settings />
                <span className="flex-1">Sign out</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[0.6875rem] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="kbd">↑</span>
                <span className="kbd">↓</span>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <span className="kbd">↵</span>
                to select
              </span>
              <span className="flex items-center gap-1">
                <span className="kbd">esc</span>
                to close
              </span>
            </div>
            <span className="font-display-italic text-[color:var(--ink-500)]">Quiksend</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Register global ⌘K / Ctrl-K handler. Import into the shell once. */
export function useCommandPaletteHotkey(setOpen: (fn: (v: boolean) => boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}
