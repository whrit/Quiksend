import {
  AlertCircle,
  BarChart3,
  Building2,
  Command as CommandIcon,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Mail,
  PencilLine,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
  Webhook,
} from "lucide-react";
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette, useCommandPaletteHotkey } from "@/components/command-palette";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { authClient } from "@/lib/auth-client";
import { getProtectedContext } from "@/lib/auth.functions";
import { Tile } from "@/components/ui/primitives.tsx";
import { ThemeToggle } from "@/components/theme-toggle.tsx";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const access = await getProtectedContext();
    if (!access.ok) {
      if (access.reason === "unauthenticated") {
        throw redirect({ to: "/login" });
      }
      if (access.reason === "not_member") {
        throw redirect({ to: "/onboarding", search: { removed: true } });
      }
      throw redirect({ to: "/onboarding" });
    }
    return { user: { id: access.userId, email: access.email, name: access.name } };
  },
  component: ProtectedLayout,
  errorComponent: ProtectedErrorBoundary,
});

function ProtectedErrorBoundary({ error }: { error: unknown }) {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "Unknown error");

  // Zod validation errors stringify to a JSON array — never dump them raw at the user.
  let friendlyMessage =
    "An unexpected error prevented this page from loading. Try reloading or returning to the dashboard.";
  try {
    const parsed = JSON.parse(rawMessage) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as { message?: string };
      friendlyMessage = first.message
        ? `Validation failed: ${(parsed as { message?: string }[])
            .map((i) => i.message)
            .filter(Boolean)
            .join(", ")}.`
        : friendlyMessage;
    }
  } catch {
    // Not JSON — use the raw message if it's a plain-English string, not "[object Object]".
    if (rawMessage && !rawMessage.startsWith("[object")) friendlyMessage = rawMessage;
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <Tile size="lg" hue="neg" tint>
        <AlertCircle />
      </Tile>
      <div className="max-w-[38ch]">
        <h1 className="text-[1.125rem] font-semibold tracking-[-0.015em]">Page failed to load</h1>
        <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{friendlyMessage}</p>
      </div>
      <div className="flex items-center gap-2">
        <Link to="/dashboard">
          <Button variant="outline" size="sm">
            Return to dashboard
          </Button>
        </Link>
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
      <details className="mt-1 max-w-lg text-left">
        <summary className="cursor-pointer select-none text-[0.6875rem] text-muted-foreground hover:text-foreground">
          Technical detail
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-[4px] border border-border bg-[color:var(--paper-050)] p-3 text-[0.625rem] leading-relaxed text-muted-foreground">
          {rawMessage}
        </pre>
      </details>
    </div>
  );
}

type NavIcon = (props: { className?: string }) => React.ReactNode;

type NavItem = { to: string; label: string; Icon: NavIcon };

const PRIMARY_NAV_GROUPS: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Pipeline",
    items: [
      { to: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { to: "/prospects", label: "Prospects", Icon: Users },
      { to: "/sequences", label: "Sequences", Icon: ListChecks },
    ],
  },
  {
    group: "Conversations",
    items: [
      { to: "/inbox", label: "Inbox", Icon: Inbox },
      { to: "/compose", label: "Compose", Icon: PencilLine },
    ],
  },
  {
    group: "Insights",
    items: [
      { to: "/analytics", label: "Analytics", Icon: BarChart3 },
      { to: "/deliverability", label: "Deliverability", Icon: Shield },
    ],
  },
];

const SETTINGS_NAV: NavItem[] = [
  { to: "/settings/mailboxes", label: "Mailboxes", Icon: Mail },
  { to: "/settings/crm", label: "CRM", Icon: Building2 },
  { to: "/settings/webhooks", label: "Webhooks", Icon: Webhook },
  { to: "/settings/api-keys", label: "API keys", Icon: KeyRound },
  { to: "/settings/value-props", label: "Value props", Icon: Sparkles },
  { to: "/settings/deliverability", label: "Deliverability rules", Icon: Shield },
  { to: "/settings/suppression", label: "Suppression", Icon: Settings },
];

function SidebarLink({
  to,
  label,
  Icon,
  currentPath,
}: {
  to: string;
  label: string;
  Icon: NavIcon;
  currentPath: string;
}) {
  const isActive = currentPath === to || currentPath.startsWith(to + "/");
  return (
    <Link to={to} className="nav-item focus-ring" data-active={isActive}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

function ProtectedLayout() {
  const { user } = Route.useRouteContext();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  useCommandPaletteHotkey(setPaletteOpen);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="flex h-screen min-h-screen overflow-hidden">
        <aside
          className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col border-r border-border bg-[color:var(--paper-050)]"
          aria-label="Primary navigation"
        >
          <div className="px-2.5 pt-3 pb-2 border-b border-border">
            <WorkspaceSwitcher />
          </div>

          <div className="px-2 py-2 border-b border-border">
            <button
              onClick={() => setPaletteOpen(true)}
              className="group flex w-full items-center gap-1.5 rounded-[4px] border border-border bg-card px-2 py-1.5 text-left text-[0.6875rem] text-muted-foreground transition-colors hover:border-[color:var(--paper-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Open command palette"
            >
              <Search className="h-3 w-3" />
              <span className="flex-1">Search</span>
              <span className="flex items-center gap-0.5">
                <span className="kbd">⌘</span>
                <span className="kbd">K</span>
              </span>
            </button>
          </div>

          <nav className="flex-1 space-y-px overflow-y-auto px-2 py-2">
            {PRIMARY_NAV_GROUPS.map(({ group, items }, gi) => (
              <div key={group} className={gi > 0 ? "pt-1" : undefined}>
                <div className="micro-label px-2 pb-1 pt-1">{group}</div>
                {items.map((item) => (
                  <SidebarLink key={item.to} {...item} currentPath={currentPath} />
                ))}
              </div>
            ))}
            <div className="pt-1">
              <div className="micro-label px-2 pb-1 pt-1">Settings</div>
              {SETTINGS_NAV.map((item) => (
                <SidebarLink key={item.to} {...item} currentPath={currentPath} />
              ))}
            </div>
          </nav>

          <div className="flex items-center gap-1 border-t border-border p-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Account menu"
                  className="group flex min-w-0 flex-1 items-center gap-2 rounded-[4px] px-1.5 py-1.5 text-left transition-colors hover:bg-[color:var(--paper-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <span
                    aria-hidden
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-[0.625rem] font-medium"
                    style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                  >
                    {(user.name || user.email).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.6875rem] font-medium leading-tight">
                      {user.name || user.email.split("@")[0]}
                    </div>
                    <div className="truncate text-[0.625rem] leading-tight text-muted-foreground">
                      {user.email}
                    </div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                <DropdownMenuLabel className="micro-label">Account</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void navigate({ to: "/settings/mailboxes" })}>
                  <Settings className="mr-2 h-3 w-3" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                  <CommandIcon className="mr-2 h-3 w-3" />
                  Command palette
                  <span className="ml-auto flex items-center gap-0.5">
                    <span className="kbd">⌘</span>
                    <span className="kbd">K</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    void authClient.signOut().then(() => window.location.assign("/login"))
                  }
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle />
          </div>
        </aside>

        <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
