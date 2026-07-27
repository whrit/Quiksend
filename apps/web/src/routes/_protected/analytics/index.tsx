import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, Layers, Plus } from "lucide-react";
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
import { Absent, EmptyState, Metric, Panel, Pill } from "@/components/ui/primitives.tsx";
import { formatCount, sequenceTone } from "@/lib/semantic.ts";
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

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function AnalyticsOverviewPage() {
  const { overview, sequencePerformance } = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6 fade-in w-full min-w-0">
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

      {/* Metrics — hair-grid, four comparable instruments */}
      <div className="hair-grid mb-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Metric value={formatCount(overview.activeSequences)} label="Active sequences" />
        <Metric value={formatCount(overview.activeEnrollments)} label="Active enrollments" />
        <Metric value={formatCount(overview.repliesThisWeek)} label="Replies this week" />
        <Metric
          value={
            <span className={overview.bounceRate > 0.03 ? "text-[color:var(--warn)]" : undefined}>
              {pct(overview.bounceRate)}
            </span>
          }
          label="Bounce rate · 30d"
        />
      </div>

      {/* Activity trend */}
      <Panel
        title="Activity trend"
        icon={<Activity />}
        hue="neutral"
        actions={
          <span className="text-[0.6875rem] text-muted-foreground">sends and replies per day</span>
        }
        className="mb-4"
      >
        {overview.dailyTrend.length === 0 ? (
          <EmptyState
            icon={<Activity />}
            hue="neutral"
            title="No activity yet"
            body="Run a sequence to start tracking sends and replies over time."
            action={
              <Link to="/sequences/new" className={buttonVariants({ size: "default" })}>
                <Plus /> Create sequence
              </Link>
            }
          />
        ) : (
          <div className="h-72 px-3 py-2.5">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overview.dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="day"
                  tick={{
                    fontSize: 11,
                    fill: "var(--paper-500)",
                    fontFamily: "IBM Plex Mono",
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{
                    fontSize: 11,
                    fill: "var(--paper-500)",
                    fontFamily: "IBM Plex Mono",
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontFamily: "IBM Plex Mono",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                <Line
                  type="monotone"
                  dataKey="sent"
                  stroke="var(--paper-400)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name="Sent"
                />
                <Line
                  type="monotone"
                  dataKey="replies"
                  stroke="var(--pos)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name="Replies"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {/* Sequence performance table */}
      <Panel
        title="Sequence performance"
        icon={<Layers />}
        hue="neutral"
        actions={<span className="text-[0.6875rem] text-muted-foreground">last 30 days</span>}
      >
        {sequencePerformance.length === 0 ? (
          <EmptyState
            icon={<Layers />}
            hue="neutral"
            title="No sequences yet"
            body="Create a sequence and enroll prospects to see per-sequence performance here."
            action={
              <Link to="/sequences/new" className={buttonVariants({ size: "default" })}>
                <Plus /> Create sequence
              </Link>
            }
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Status</th>
                <th className="num">Sent</th>
                <th className="num">Replies</th>
                <th className="num">Bounces</th>
                <th className="num">Reply rate</th>
              </tr>
            </thead>
            <tbody>
              {sequencePerformance.map((row) => (
                <tr key={row.sequenceId}>
                  <td>
                    <Link
                      to="/sequences/$id/analytics"
                      params={{ id: row.sequenceId }}
                      className="block max-w-[32ch] truncate font-medium hover:underline"
                      title={row.sequenceName}
                    >
                      {row.sequenceName}
                    </Link>
                  </td>
                  <td>
                    <Pill tone={sequenceTone(row.sequenceStatus)} dot>
                      {row.sequenceStatus}
                    </Pill>
                  </td>
                  <td className="num">{formatCount(row.sent)}</td>
                  <td className="num">{formatCount(row.replied)}</td>
                  <td className="num">
                    {row.bounced > 0 ? (
                      <span className="text-[color:var(--neg)]">{formatCount(row.bounced)}</span>
                    ) : (
                      formatCount(row.bounced)
                    )}
                  </td>
                  <td className="num">
                    {row.sent === 0 ? (
                      <Absent>No sends</Absent>
                    ) : (
                      <span
                        className={
                          row.replyRate >= 0.05 ? "text-foreground" : "text-muted-foreground"
                        }
                      >
                        {pct(row.replyRate)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
