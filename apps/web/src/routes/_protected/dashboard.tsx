import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Import,
  Mail,
  PencilLine,
  Plus,
  Rocket,
  Shield,
  Sparkles,
  Users,
  Webhook,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getGatewayMixForOrg } from "@/lib/prospects.functions.ts";
import { getWorkspaceOverview } from "@/lib/analytics.functions.ts";
import { Route as ProtectedRoute } from "@/routes/_protected";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_protected/dashboard")({
  loader: async () => {
    const [overview, gatewayMix] = await Promise.all([
      getWorkspaceOverview(),
      getGatewayMixForOrg({ data: {} }),
    ]);
    return { overview, gatewayMix };
  },
  component: Dashboard,
});

type QuickAction = {
  to: string;
  label: string;
  description: string;
  Icon: (props: { className?: string }) => React.ReactNode;
  primary?: boolean;
};

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    to: "/settings/mailboxes/new",
    label: "Connect a mailbox",
    description: "Gmail, Microsoft, or SMTP — start here so sequences can send.",
    Icon: Mail,
    primary: true,
  },
  {
    to: "/prospects/import",
    label: "Import prospects",
    description: "Drop a CSV or paste rows to add contacts and companies.",
    Icon: Import,
  },
  {
    to: "/sequences/new",
    label: "Create a sequence",
    description: "Multi-step outreach with delays, sending window, and A/B.",
    Icon: PencilLine,
  },
  {
    to: "/compose",
    label: "Send a one-off",
    description: "Compose to a single prospect from any connected mailbox.",
    Icon: Rocket,
  },
];

const SECONDARY_LINKS: readonly QuickAction[] = [
  {
    to: "/prospects",
    label: "Prospects",
    description: "Manage contacts and companies.",
    Icon: Users,
  },
  {
    to: "/settings/crm",
    label: "CRM sync",
    description: "Salesforce or HubSpot two-way sync.",
    Icon: Webhook,
  },
  {
    to: "/settings/value-props",
    label: "Value props",
    description: "Feed the AI what to pitch.",
    Icon: Sparkles,
  },
  {
    to: "/deliverability",
    label: "Deliverability grid",
    description: "See SEG signal per mailbox.",
    Icon: Shield,
  },
];

function StatCard({ label, value, to }: { label: string; value: string | number; to?: string }) {
  const content = (
    <>
      <CardDescription>{label}</CardDescription>
      <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      >
        <Card className="transition-colors group-hover:border-foreground/20">
          <CardHeader className="pb-2">{content}</CardHeader>
        </Card>
      </Link>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">{content}</CardHeader>
    </Card>
  );
}

function QuickActionCard({ action }: { action: QuickAction }) {
  return (
    <Link
      to={action.to}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
    >
      <Card
        className={cn(
          "h-full transition-all hover:border-foreground/20 hover:shadow-sm",
          action.primary && "border-primary/40 bg-primary/5",
        )}
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <action.Icon
              className={cn("h-5 w-5", action.primary ? "text-primary" : "text-muted-foreground")}
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <CardTitle className="text-base">{action.label}</CardTitle>
          <CardDescription>{action.description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

function EmptyStateHero({ userName }: { userName: string }) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-2xl">Welcome, {userName} 👋</CardTitle>
        <CardDescription className="text-base">
          You're set up. Pick one of these to get your first email out — most workspaces connect a
          mailbox first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <QuickActionCard key={action.to} action={action} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { user } = ProtectedRoute.useRouteContext();
  const { overview, gatewayMix } = Route.useLoaderData();
  const isEmpty =
    overview.activeSequences === 0 &&
    overview.activeEnrollments === 0 &&
    overview.repliesThisWeek === 0 &&
    gatewayMix.mix.length === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {isEmpty ? (
        <EmptyStateHero userName={user.name || user.email} />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Welcome back, {user.name || user.email}</CardTitle>
              <CardDescription>Your workspace at a glance.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Link to="/sequences/new" className={buttonVariants({ size: "sm" })}>
                <Plus className="mr-1.5 h-4 w-4" />
                New sequence
              </Link>
              <Link
                to="/prospects/import"
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                <Import className="mr-1.5 h-4 w-4" />
                Import prospects
              </Link>
            </div>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active sequences" value={overview.activeSequences} to="/sequences" />
        <StatCard label="Active enrollments" value={overview.activeEnrollments} to="/sequences" />
        <StatCard label="Replies this week" value={overview.repliesThisWeek} to="/inbox" />
        <StatCard
          label="Bounce rate (30d)"
          value={`${(overview.bounceRate * 100).toFixed(1)}%`}
          to="/deliverability"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prospect gateway mix</CardTitle>
          <CardDescription>
            {(gatewayMix.classifiedPct * 100).toFixed(0)}% classified
            {gatewayMix.classifiedPct < 0.9
              ? " — classifying in background, refresh in a minute"
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          {gatewayMix.mix.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">No classified prospects yet.</p>
              <Link
                to="/prospects/import"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Import prospects to classify
              </Link>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gatewayMix.mix} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <YAxis type="category" dataKey="gateway" width={96} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => `${(value * 100).toFixed(1)}%`} />
                <Bar dataKey="pct" fill="hsl(var(--primary))" radius={2} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Explore more</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SECONDARY_LINKS.map((action) => (
              <QuickActionCard key={action.to} action={action} />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Link to="/analytics" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Full analytics →
        </Link>
      </div>
    </div>
  );
}
