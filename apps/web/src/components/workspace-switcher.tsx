import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * Workspace switcher — designed as the anchor of the sidebar header. The active
 * workspace name lives in Instrument Serif for editorial gravitas ("The Ledger",
 * "Acme Q4", etc. all read like publication titles). Initials tile carries the
 * amber accent as a signature moment.
 */
export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { data: organizations } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const initials = useMemo(() => {
    const src = active?.name ?? "?";
    return src
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("");
  }, [active?.name]);

  const create = async () => {
    if (!name.trim()) return;
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    await authClient.organization.create({ name: name.trim(), slug });
    setName("");
    setCreating(false);
  };

  const switchTo = async (organizationId: string) => {
    await authClient.organization.setActive({ organizationId });
    // Reload so all loaders re-fetch under the new org.
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
            "hover:bg-[color:var(--ink-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md font-medium text-[0.7rem] text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.12),0_1px_2px_rgba(140,80,20,0.2)]"
            style={{ background: "var(--amber-600)", letterSpacing: "0.02em" }}
          >
            {initials || "·"}
          </span>
          {!compact && (
            <>
              <div className="min-w-0 flex-1">
                <div className="micro-label leading-none">Workspace</div>
                <div className="mt-1 truncate font-display text-[1.0625rem] leading-none text-foreground">
                  {active?.name ?? "Select workspace"}
                </div>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--ink-400)] transition-colors group-hover:text-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-1.5">
        <DropdownMenuLabel className="micro-label px-2 py-1.5">Workspaces</DropdownMenuLabel>
        {(organizations ?? []).map((org) => {
          const isActive = active?.id === org.id;
          return (
            <DropdownMenuItem
              key={org.id}
              onSelect={() => void switchTo(org.id)}
              className="flex items-center gap-2 px-2 py-1.5 text-[0.8125rem]"
            >
              <span
                aria-hidden
                className="grid h-5 w-5 place-items-center rounded text-[0.625rem] font-medium text-white"
                style={{ background: isActive ? "var(--amber-600)" : "var(--ink-400)" }}
              >
                {org.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate flex-1">{org.name}</span>
              {isActive && <Check className="h-3.5 w-3.5 text-[color:var(--amber-600)]" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {creating ? (
          <div className="flex gap-1.5 p-1.5">
            <Input
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
                if (e.key === "Escape") {
                  setCreating(false);
                  setName("");
                }
              }}
            />
            <Button size="sm" variant="accent" onClick={() => void create()}>
              Create
            </Button>
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setCreating(true);
            }}
            className="flex items-center gap-2 px-2 py-1.5 text-[0.8125rem]"
          >
            <Plus className="h-3.5 w-3.5" />
            New workspace
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
