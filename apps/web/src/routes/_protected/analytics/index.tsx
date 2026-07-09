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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSequencePerformance, getWorkspaceOverview } from "@/lib/analytics.functions.ts";

export const Route = createFileRoute("/_protected/analytics/")({
  loader: async () => {
    const [overview, sequencePerformance] = await Promise.all([
      getWorkspaceOverview(),
      getSequencePerformance(),
    ]);
    return { overview, sequencePerformance };
  },
  component: AnalyticsOverviewPage,
});

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel px-3 py-2.5">
      <div className="micro-label">{label}</div>
      <div className="mt-0.5 font-mono tabular text-[1.5rem] font-semibold leading-none text-foreground">
        {value}
      </div>
    </div>
  );
}

function AnalyticsOverviewPage() {
  const { overview, sequencePerformance } = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6 fade-in">
      <header className="mb-4 flex items-end justify-between gap-6 border-b border-border pb-4">
        <div>
          <div className="micro-label">Last 30 days</div>
          <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Analytics
          </h1>
          <p className="mt-1 text-[0.75rem] text-muted-foreground">
            Workspace overview and per-sequence performance.
          </p>
        </div>
        <Link to="/dashboard" className={buttonVariants({ variant: "ghost", size: "default" })}>
          ← Dashboard
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active sequences" value={overview.activeSequences} />
        <StatCard label="Active enrollments" value={overview.activeEnrollments} />
        <StatCard label="Replies this week" value={overview.repliesThisWeek} />
        <StatCard label="Bounce rate (30d)" value={`${(overview.bounceRate * 100).toFixed(1)}%`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity trend</CardTitle>
          <CardDescription>Sends and replies per day</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {overview.dailyTrend.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events yet — run a sequence to populate.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overview.dailyTrend}>
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

      <Card>
        <CardHeader>
          <CardTitle>Sequence performance</CardTitle>
          <CardDescription>Per-sequence sends, replies and bounces — last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          {sequencePerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sequences yet — create one and enroll prospects to see per-sequence performance.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sequence</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Bounces</TableHead>
                  <TableHead className="text-right">Reply rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sequencePerformance.map((row) => (
                  <TableRow key={row.sequenceId}>
                    <TableCell>
                      <Link
                        to="/sequences/$id/analytics"
                        params={{ id: row.sequenceId }}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.sequenceName}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.sequenceStatus}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.sent}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.replied}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.bounced}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {`${(row.replyRate * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
