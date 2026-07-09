import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Import, Plus } from "lucide-react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { buttonVariants } from "@/components/ui/button";
import { getGatewayMixForOrg } from "@/lib/prospects.functions.ts";
import { getSequencePerformance, getWorkspaceOverview } from "@/lib/analytics.functions.ts";
import { Route as ProtectedRoute } from "@/routes/_protected";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_protected/dashboard")({
  loader: async () => {
    const [overview, gatewayMix, sequences] = await Promise.all([
      getWorkspaceOverview(),
      getGatewayMixForOrg({ data: {} }),
      getSequencePerformance(),
    ]);
    return { overview, gatewayMix, sequences };
  },
  component: Dashboard,
});

const num = new Intl.NumberFormat("en-US");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/* ─── Compact metric — number + label + inline sparkline ────────────────── */
function Metric({
  label,
  value,
  sub,
  trend,
  to,
  variant = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number[];
  to?: string;
  variant?: "default" | "warn";
}) {
  const trendData = trend?.map((v, i) => ({ i, v }));
  const body = (
    <div className="panel group flex h-full min-h-[92px] flex-col justify-between px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="micro-label">{label}</span>
        {to && (
          <ArrowRight className="h-3 w-3 text-[color:var(--paper-300)] transition-colors group-hover:text-foreground" />
        )}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "font-mono text-[1.75rem] font-medium leading-none tabular tracking-[-0.02em]",
              variant === "warn" && "text-[color:var(--status-yellow-600)]",
            )}
          >
            {value}
          </div>
          {sub && <div className="mt-1 text-[0.6875rem] text-muted-foreground truncate">{sub}</div>}
        </div>
        {trendData && trendData.length > 1 && (
          <div className="h-9 w-24 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="var(--foreground)"
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
  if (to) return <Link to={to}>{body}</Link>;
  return body;
}

const STATUS_STYLE: Record<"draft" | "active" | "archived", string> = {
  draft: "text-muted-foreground bg-[color:var(--paper-100)]",
  active: "text-[color:var(--status-green-600)] bg-[color:var(--status-green-050)]",
  archived: "text-muted-foreground bg-[color:var(--paper-100)]",
};

/* ─── Getting-started row — quiet, dense ────────────────────────────────── */
function StartLink({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0 hover:text-foreground"
    >
      <div className="min-w-0">
        <div className="text-[0.75rem] font-medium text-foreground">{label}</div>
        <div className="text-[0.6875rem] text-muted-foreground truncate">{hint}</div>
      </div>
      <ArrowRight className="h-3 w-3 shrink-0 text-[color:var(--paper-300)] transition-colors group-hover:text-foreground" />
    </Link>
  );
}

function Dashboard() {
  const { user } = ProtectedRoute.useRouteContext();
  const { overview, gatewayMix, sequences } = Route.useLoaderData();

  const isEmpty =
    overview.activeSequences === 0 &&
    overview.activeEnrollments === 0 &&
    overview.repliesThisWeek === 0 &&
    sequences.length === 0;

  const trendReplies = overview.dailyTrend.map((d) => d.replies);
  const trendSent = overview.dailyTrend.map((d) => d.sent);

  const bounceVariant = overview.bounceRate > 0.03 ? "warn" : "default";
  const totalGatewayShare = gatewayMix.mix.reduce((s, m) => s + m.pct, 0);
  const firstName = (user.name || user.email.split("@")[0] || "").trim();

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6 fade-in">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-border">
        <div>
          <div className="micro-label">Dashboard</div>
          <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Welcome back, {firstName}
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/prospects/import"
            className={buttonVariants({ variant: "outline", size: "default" })}
          >
            <Import /> Import prospects
          </Link>
          <Link to="/sequences/new" className={buttonVariants({ size: "default" })}>
            <Plus /> New sequence
          </Link>
        </div>
      </header>

      {isEmpty ? (
        <EmptyDashboard />
      ) : (
        <>
          {/* Metrics row — compact, sparklines inline */}
          <section className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Active sequences"
              value={num.format(overview.activeSequences)}
              sub={
                overview.activeSequences === 1 ? "1 running" : `${overview.activeSequences} running`
              }
              to="/sequences"
            />
            <Metric
              label="Live enrollments"
              value={num.format(overview.activeEnrollments)}
              sub="prospects mid-sequence"
              to="/sequences"
            />
            <Metric
              label="Replies · 7d"
              value={num.format(overview.repliesThisWeek)}
              trend={trendReplies.slice(-14)}
              to="/inbox"
            />
            <Metric
              label="Bounce · 30d"
              value={pct(overview.bounceRate)}
              sub={overview.bounceRate > 0.03 ? "above 3% threshold" : "within threshold"}
              variant={bounceVariant}
              to="/deliverability"
            />
          </section>

          {/* Main grid: sequences table + side column */}
          <section className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div className="panel overflow-hidden">
              <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
                <div>
                  <div className="text-[0.8125rem] font-medium">Sequence performance</div>
                  <div className="text-[0.6875rem] text-muted-foreground">last 30 days</div>
                </div>
                <Link
                  to="/analytics"
                  className="text-[0.6875rem] text-muted-foreground hover:text-foreground"
                >
                  Full analytics →
                </Link>
              </div>
              {sequences.length === 0 ? (
                <div className="p-8 text-center text-[0.75rem] text-muted-foreground">
                  No sequences yet.{" "}
                  <Link
                    to="/sequences/new"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    Create one
                  </Link>
                  .
                </div>
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
                    {sequences.slice(0, 8).map((s) => (
                      <tr key={s.sequenceId}>
                        <td>
                          <Link
                            to="/sequences/$id/edit"
                            params={{ id: s.sequenceId }}
                            className="font-medium hover:underline"
                          >
                            {s.sequenceName}
                          </Link>
                        </td>
                        <td>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[0.625rem] font-medium",
                              STATUS_STYLE[s.sequenceStatus],
                            )}
                          >
                            {s.sequenceStatus}
                          </span>
                        </td>
                        <td className="num">{num.format(s.sent)}</td>
                        <td className="num">{num.format(s.replied)}</td>
                        <td className="num">
                          <span
                            className={
                              s.bounced > 0
                                ? "text-[color:var(--status-red-600)]"
                                : "text-muted-foreground"
                            }
                          >
                            {num.format(s.bounced)}
                          </span>
                        </td>
                        <td className="num">
                          <span
                            className={
                              s.replyRate >= 0.05 ? "text-foreground" : "text-muted-foreground"
                            }
                          >
                            {pct(s.replyRate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="space-y-3">
              {/* Reply trend chart */}
              <div className="panel px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[0.8125rem] font-medium">Replies · 30d</div>
                    <div className="text-[0.6875rem] text-muted-foreground">daily</div>
                  </div>
                  <div className="font-mono text-[0.6875rem] tabular text-muted-foreground">
                    Σ {num.format(trendReplies.reduce((a, b) => a + b, 0))}
                  </div>
                </div>
                <div className="mt-2 h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={overview.dailyTrend.map((d) => ({
                        day: d.day.slice(5),
                        replies: d.replies,
                      }))}
                    >
                      <XAxis
                        dataKey="day"
                        tick={{
                          fontSize: 9,
                          fill: "var(--paper-500)",
                          fontFamily: "IBM Plex Mono",
                        }}
                        axisLine={false}
                        tickLine={false}
                        interval={4}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--paper-100)" }}
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          padding: "3px 6px",
                          fontSize: 11,
                          fontFamily: "IBM Plex Mono",
                        }}
                      />
                      <Bar dataKey="replies" fill="var(--foreground)" radius={0} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gateway mix — compact list */}
              <div className="panel overflow-hidden">
                <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
                  <div>
                    <div className="text-[0.8125rem] font-medium">Gateway mix</div>
                    <div className="text-[0.6875rem] text-muted-foreground">
                      {(gatewayMix.classifiedPct * 100).toFixed(0)}% classified
                    </div>
                  </div>
                </div>
                {gatewayMix.mix.length === 0 ? (
                  <div className="p-4 text-center text-[0.6875rem] text-muted-foreground">
                    No classified prospects yet.
                  </div>
                ) : (
                  <div className="p-2">
                    {gatewayMix.mix.map((row) => {
                      const width = totalGatewayShare > 0 ? (row.pct / totalGatewayShare) * 100 : 0;
                      return (
                        <div
                          key={row.gateway}
                          className="grid grid-cols-[80px_1fr_44px] items-center gap-2 py-1 text-[0.6875rem]"
                        >
                          <span className="truncate text-muted-foreground">
                            {row.gateway.replace(/_/g, " ")}
                          </span>
                          <div className="h-1 rounded-full bg-[color:var(--paper-100)]">
                            <div
                              className="h-full rounded-full bg-[color:var(--paper-700)]"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span className="text-right font-mono tabular text-foreground">
                            {(row.pct * 100).toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Getting started */}
              <div className="panel px-3 py-2">
                <div className="text-[0.8125rem] font-medium">Getting started</div>
                <div className="mt-1">
                  <StartLink
                    to="/sequences/new"
                    label="Create a sequence"
                    hint="multi-step outbound cadence"
                  />
                  <StartLink to="/prospects/import" label="Import prospects" hint="upload a CSV" />
                  <StartLink
                    to="/settings/mailboxes"
                    label="Connect a mailbox"
                    hint="Gmail, Microsoft, or SMTP"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Reply cadence — 30-day sent vs replies */}
          <section className="mt-3 panel px-3 py-2.5">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-[0.8125rem] font-medium">Sent vs replies · 30d</div>
                <div className="text-[0.6875rem] text-muted-foreground">
                  {num.format(trendSent.reduce((a, b) => a + b, 0))} sent ·{" "}
                  {num.format(trendReplies.reduce((a, b) => a + b, 0))} replies
                </div>
              </div>
            </div>
            <div className="mt-2 h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={overview.dailyTrend.map((d) => ({
                    day: d.day.slice(5),
                    sent: d.sent,
                    replies: d.replies,
                  }))}
                >
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 9, fill: "var(--paper-500)", fontFamily: "IBM Plex Mono" }}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--paper-200)", strokeDasharray: "2 2" }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "3px 6px",
                      fontSize: 11,
                      fontFamily: "IBM Plex Mono",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="sent"
                    stroke="var(--paper-400)"
                    strokeWidth={1.25}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="replies"
                    stroke="var(--foreground)"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center gap-4 text-[0.625rem] font-mono text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-px w-3 bg-[color:var(--paper-400)]" />
                sent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-px w-3 bg-foreground" />
                replies
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ─── Empty state — direct copy, no italic hero ─────────────────────────── */
function EmptyDashboard() {
  return (
    <div className="panel px-6 py-8">
      <div className="max-w-lg">
        <div className="micro-label">Getting started</div>
        <h2 className="mt-1 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
          Connect a mailbox and import prospects to start
        </h2>
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted-foreground">
          Sequences build on top of prospects and mailboxes. Once you have both, canary sends
          monitor deliverability and the inbox catches replies.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            to="/settings/mailboxes"
            className={buttonVariants({ variant: "default", size: "default" })}
          >
            Connect mailbox
          </Link>
          <Link
            to="/prospects/import"
            className={buttonVariants({ variant: "outline", size: "default" })}
          >
            Import prospects
          </Link>
          <Link
            to="/sequences/new"
            className={buttonVariants({ variant: "ghost", size: "default" })}
          >
            Draft a sequence
          </Link>
        </div>
      </div>
    </div>
  );
}
