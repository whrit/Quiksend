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
 * Workspace switcher — sidebar anchor. Neutral initials tile, workspace
 * name in body sans (not serif). Direct product language throughout.
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
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "group flex w-full items-center gap-2 rounded-[4px] px-1.5 py-1.5 text-left transition-colors",
            "hover:bg-[color:var(--paper-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span
            aria-hidden
            className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-[0.625rem] font-medium text-white"
            style={{ background: "var(--paper-900)", letterSpacing: "0.02em" }}
          >
            {initials || "·"}
          </span>
          {!compact && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.75rem] font-medium leading-tight text-foreground">
                  {active?.name ?? "Select workspace"}
                </div>
                <div className="truncate text-[0.6875rem] leading-tight text-muted-foreground">
                  {organizations?.length ?? 0} workspace
                  {(organizations?.length ?? 0) === 1 ? "" : "s"}
                </div>
              </div>
              <ChevronsUpDown className="h-3 w-3 shrink-0 text-[color:var(--paper-400)] transition-colors group-hover:text-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 p-1">
        <DropdownMenuLabel className="micro-label px-2 py-1">Workspaces</DropdownMenuLabel>
        {(organizations ?? []).map((org) => {
          const isActive = active?.id === org.id;
          return (
            <DropdownMenuItem
              key={org.id}
              onSelect={() => void switchTo(org.id)}
              className="flex items-center gap-2 px-2 py-1.5 text-[0.75rem]"
            >
              <span
                aria-hidden
                className="grid h-4 w-4 place-items-center rounded-[2px] text-[0.5625rem] font-medium text-white"
                style={{ background: isActive ? "var(--paper-900)" : "var(--paper-400)" }}
              >
                {org.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate flex-1">{org.name}</span>
              {isActive && <Check className="h-3 w-3 text-foreground" />}
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
            <Button size="sm" onClick={() => void create()}>
              Create
            </Button>
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setCreating(true);
            }}
            className="flex items-center gap-2 px-2 py-1.5 text-[0.75rem]"
          >
            <Plus className="h-3 w-3" />
            New workspace
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
