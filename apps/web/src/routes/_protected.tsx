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
      <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Something went wrong</h1>
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

const PRIMARY_NAV: Array<{ to: string; label: string; Icon: NavIcon }> = [
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
  { to: "/settings/crm", label: "CRM", Icon: Webhook },
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
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="flex min-h-screen">
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
            <div className="micro-label px-2 pb-1 pt-1">Workspace</div>
            {PRIMARY_NAV.map((item) => (
              <SidebarLink key={item.to} {...item} currentPath={currentPath} />
            ))}

            <div className="micro-label px-2 pb-1 pt-3">Settings</div>
            {SETTINGS_NAV.map((item) => (
              <SidebarLink key={item.to} {...item} currentPath={currentPath} />
            ))}
          </nav>

          <div className="border-t border-border p-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="group flex w-full items-center gap-2 rounded-[4px] px-1.5 py-1.5 text-left transition-colors hover:bg-[color:var(--paper-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span
                    aria-hidden
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-[0.625rem] font-medium text-white"
                    style={{ background: "var(--paper-900)" }}
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
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
