import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspaceOverview } from "@/lib/analytics.functions.ts";

export const Route = createFileRoute("/_protected/analytics/")({
  loader: async () => getWorkspaceOverview(),
  component: AnalyticsOverviewPage,
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

function AnalyticsOverviewPage() {
  const data = Route.useLoaderData();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">Workspace overview — last 30 days</p>
        </div>
        <Link to="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Dashboard
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active sequences" value={data.activeSequences} />
        <StatCard label="Active enrollments" value={data.activeEnrollments} />
        <StatCard label="Replies this week" value={data.repliesThisWeek} />
        <StatCard label="Bounce rate (30d)" value={`${(data.bounceRate * 100).toFixed(1)}%`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity trend</CardTitle>
          <CardDescription>Sends and replies per day</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {data.dailyTrend.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events yet — run a sequence to populate.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sent" stroke="hsl(var(--primary))" name="Sent" />
                <Line type="monotone" dataKey="replies" stroke="#16a34a" name="Replies" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
