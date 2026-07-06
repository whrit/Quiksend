import {
  BarChart3,
  ChevronDown,
  Cog,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Mail,
  MailPlus,
  Ban,
  PencilLine,
  Settings,
  Shield,
  Sparkles,
  Users,
  Webhook,
} from "lucide-react";
import { Outlet, createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { authClient } from "@/lib/auth-client";
import { getProtectedContext } from "@/lib/auth.functions";
import { cn } from "@/lib/utils";

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
});

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
  { to: "/settings/crm", label: "CRM connections", Icon: Cog },
  { to: "/settings/webhooks", label: "Webhooks", Icon: Webhook },
  { to: "/settings/api-keys", label: "API keys", Icon: KeyRound },
  { to: "/settings/value-props", label: "Value props", Icon: Sparkles },
  { to: "/settings/deliverability", label: "Deliverability settings", Icon: Shield },
  { to: "/settings/suppression", label: "Suppression list", Icon: Ban },
];

function NavLink({ to, label, Icon }: { to: string; label: string; Icon: NavIcon }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground",
        "hover:bg-muted hover:text-foreground",
      )}
      activeProps={{
        className: cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
          "bg-muted font-medium text-foreground",
        ),
      }}
      activeOptions={{ includeSearch: false }}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function SettingsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Settings className="mr-1.5 h-4 w-4" />
          Settings
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Workspace settings</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SETTINGS_NAV.map(({ to, label, Icon }) => (
          <DropdownMenuItem asChild key={to}>
            <Link to={to} className="flex cursor-pointer items-center gap-2">
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProtectedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
            <MailPlus className="h-5 w-5 text-primary" />
            <span>Quiksend</span>
          </Link>
          <WorkspaceSwitcher />
        </div>
        <nav className="order-3 flex flex-1 basis-full items-center gap-1 md:order-2 md:basis-auto">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.to} {...item} />
          ))}
        </nav>
        <div className="order-2 flex items-center gap-2 md:order-3">
          <SettingsMenu />
          <span className="hidden text-sm text-muted-foreground md:inline">{user.email}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void authClient.signOut().then(() => window.location.assign("/login"))}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
