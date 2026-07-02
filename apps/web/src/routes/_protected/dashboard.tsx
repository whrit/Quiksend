import { Link, createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getGatewayMixForOrg } from "@/lib/prospects.functions.ts";
import { getWorkspaceOverview } from "@/lib/analytics.functions.ts";
import { Route as ProtectedRoute } from "@/routes/_protected";

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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function Dashboard() {
  const { user } = ProtectedRoute.useRouteContext();
  const { overview, gatewayMix } = Route.useLoaderData();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {user.name || user.email}</CardTitle>
          <CardDescription>
            You are signed in. Use the navigation to manage prospects and sequences.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active sequences" value={overview.activeSequences} />
        <StatCard label="Active enrollments" value={overview.activeEnrollments} />
        <StatCard label="Replies this week" value={overview.repliesThisWeek} />
        <StatCard label="Bounce rate (30d)" value={`${(overview.bounceRate * 100).toFixed(1)}%`} />
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
            <p className="text-sm text-muted-foreground">No classified prospects yet.</p>
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

      <Link to="/analytics" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Full analytics →
      </Link>
    </div>
  );
}
