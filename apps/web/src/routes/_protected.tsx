import {
  BarChart3,
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

export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const access = await getProtectedContext();
    if (!access.ok) {
      if (access.reason === "unauthenticated") {
        throw redirect({ to: "/login" });
      }
      throw redirect({ to: "/onboarding" });
    }
    return { user: { id: access.userId, email: access.email, name: access.name } };
  },
  component: ProtectedLayout,
  errorComponent: ProtectedErrorBoundary,
});

function ProtectedErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="font-display text-[2rem] leading-none">Something snapped.</h1>
      <p className="max-w-lg text-[0.8125rem] text-muted-foreground">{message}</p>
      <div className="mt-2 flex items-center gap-2">
        <Link to="/dashboard">
          <Button variant="outline" size="sm">
            Return to dashboard
          </Button>
        </Link>
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}

type NavIcon = (props: { className?: string }) => React.ReactNode;

/** Primary navigation — the editorial "sections" of the app. */
const PRIMARY_NAV: Array<{ to: string; label: string; Icon: NavIcon; badge?: string }> = [
  { to: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/prospects", label: "Prospects", Icon: Users },
  { to: "/sequences", label: "Sequences", Icon: ListChecks },
  { to: "/inbox", label: "Inbox", Icon: Inbox },
  { to: "/compose", label: "Compose", Icon: PencilLine },
  { to: "/analytics", label: "Analytics", Icon: BarChart3 },
  { to: "/deliverability", label: "Deliverability", Icon: Shield },
];

const SETTINGS_NAV: Array<{ to: string; label: string; Icon: NavIcon }> = [
  { to: "/settings/mailboxes", label: "Mailboxes", Icon: Mail },
  { to: "/settings/crm", label: "CRM connections", Icon: Webhook },
  { to: "/settings/webhooks", label: "Webhooks", Icon: Webhook },
  { to: "/settings/api-keys", label: "API keys", Icon: KeyRound },
  { to: "/settings/value-props", label: "Value props", Icon: Sparkles },
  { to: "/settings/deliverability", label: "Deliverability", Icon: Shield },
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
    <div className="grain relative min-h-screen bg-background text-foreground">
      <div className="relative z-[2] flex min-h-screen">
        {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-border"
          style={{ background: "linear-gradient(180deg, var(--card) 0%, var(--background) 100%)" }}
        >
          <div className="px-3 pt-4 pb-3">
            <WorkspaceSwitcher />
          </div>

          <div className="mx-3 mb-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="group flex w-full items-center gap-2 rounded-[6px] border border-border bg-card px-2 py-1.5 text-left text-[0.75rem] text-muted-foreground shadow-[inset_0_1px_1px_rgba(20,15,5,0.02)] transition-colors hover:border-[color:var(--ink-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1">Search or command</span>
              <span className="flex items-center gap-0.5">
                <span className="kbd">⌘</span>
                <span className="kbd">K</span>
              </span>
            </button>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-4 pl-[18px]">
            <div className="micro-label px-3 pb-1.5 pt-2">Workspace</div>
            {PRIMARY_NAV.map((item) => (
              <SidebarLink key={item.to} {...item} currentPath={currentPath} />
            ))}

            <div className="micro-label px-3 pb-1.5 pt-4">Settings</div>
            {SETTINGS_NAV.map((item) => (
              <SidebarLink key={item.to} {...item} currentPath={currentPath} />
            ))}
          </nav>

          {/* Sidebar footer — user identity */}
          <div className="border-t border-border p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-[color:var(--ink-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span
                    aria-hidden
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.6875rem] font-medium text-white"
                    style={{ background: "var(--ink-950)" }}
                  >
                    {(user.name || user.email).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.75rem] font-medium leading-tight">
                      {user.name || user.email.split("@")[0]}
                    </div>
                    <div className="truncate text-[0.6875rem] text-muted-foreground leading-tight">
                      {user.email}
                    </div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56">
                <DropdownMenuLabel className="micro-label">Account</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void navigate({ to: "/settings/mailboxes" })}>
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                  <CommandIcon className="mr-2 h-3.5 w-3.5" />
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
          </div>
        </aside>

        {/* ─── Main ────────────────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
