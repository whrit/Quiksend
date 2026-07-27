import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowRight, Import, Layers, Mail, MailWarning, Plus } from "lucide-react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { GatewayBadge } from "@/components/gateway-badge.tsx";
import { buttonVariants } from "@/components/ui/button";
import { Absent, EmptyState, Metric, Pill, Tile } from "@/components/ui/primitives.tsx";
import { getGatewayMixForOrg } from "@/lib/prospects.functions.ts";
import { formatCount, gatewayMeta, sequenceTone } from "@/lib/semantic.ts";
import { getSequencePerformance, getWorkspaceOverview } from "@/lib/analytics.functions.ts";
import { Route as ProtectedRoute } from "@/routes/_protected";

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

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

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
  const hasActivity = overview.dailyTrend.some((d) => d.sent > 0 || d.replies > 0);

  const totalGatewayShare = gatewayMix.mix.reduce((s, m) => s + m.pct, 0);
  const firstName = (user.name || user.email.split("@")[0] || "").trim();

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6 fade-in w-full min-w-0">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
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
          {/* Metrics — hair-grid, four comparable instruments */}
          <div className="hair-grid mb-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <Link to="/sequences" className="block">
              <Metric value={formatCount(overview.activeSequences)} label="Active sequences" />
            </Link>
            <Link to="/sequences" className="block">
              <Metric value={formatCount(overview.activeEnrollments)} label="Live enrollments" />
            </Link>
            <Link to="/inbox" className="block">
              <Metric value={formatCount(overview.repliesThisWeek)} label="Replies · 7d" />
            </Link>
            <Link to="/deliverability" className="block">
              <Metric
                value={
                  <span
                    className={overview.bounceRate > 0.03 ? "text-[color:var(--warn)]" : undefined}
                  >
                    {pct(overview.bounceRate)}
                  </span>
                }
                label="Bounce rate · 30d"
              />
            </Link>
          </div>

          {/* Main grid: sequences table + side column */}
          <section className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            {/* Sequence performance table */}
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
                <EmptyState
                  icon={<Layers />}
                  hue="neutral"
                  title="No sequences yet"
                  body="Create a sequence and enroll prospects to see per-sequence performance."
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
                    {sequences.slice(0, 8).map((s) => (
                      <tr key={s.sequenceId}>
                        <td>
                          <Link
                            to="/sequences/$id/edit"
                            params={{ id: s.sequenceId }}
                            className="block max-w-[28ch] truncate font-medium hover:underline"
                            title={s.sequenceName}
                          >
                            {s.sequenceName}
                          </Link>
                        </td>
                        <td>
                          <Pill tone={sequenceTone(s.sequenceStatus)} dot>
                            {s.sequenceStatus}
                          </Pill>
                        </td>
                        <td className="num">{formatCount(s.sent)}</td>
                        <td className="num">{formatCount(s.replied)}</td>
                        <td className="num">
                          {s.bounced > 0 ? (
                            <span className="text-[color:var(--neg)]">
                              {formatCount(s.bounced)}
                            </span>
                          ) : (
                            formatCount(s.bounced)
                          )}
                        </td>
                        <td className="num">
                          {s.sent === 0 ? (
                            <Absent>No sends</Absent>
                          ) : (
                            <span
                              className={
                                s.replyRate >= 0.05 ? "text-foreground" : "text-muted-foreground"
                              }
                            >
                              {pct(s.replyRate)}
                            </span>
                          )}
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
                    Σ {formatCount(trendReplies.reduce((a, b) => a + b, 0))}
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

              {/* Gateway mix — categorically coloured bars */}
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
                  <EmptyState
                    icon={<MailWarning />}
                    hue="neutral"
                    title="No gateway data yet"
                    body="Import prospects so Quiksend can classify their email gateways."
                    action={
                      <Link
                        to="/prospects/import"
                        className={buttonVariants({ variant: "outline", size: "default" })}
                      >
                        Import prospects
                      </Link>
                    }
                  />
                ) : (
                  <div className="p-2">
                    {gatewayMix.mix.map((row) => {
                      const width = totalGatewayShare > 0 ? (row.pct / totalGatewayShare) * 100 : 0;
                      const { cat } = gatewayMeta(row.gateway);
                      return (
                        <div
                          key={row.gateway}
                          className="grid grid-cols-[1fr_80px_44px] items-center gap-2 py-1 text-[0.6875rem]"
                        >
                          <GatewayBadge gateway={row.gateway} />
                          <div className="h-1 rounded-full bg-[color:var(--paper-100)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${width}%`,
                                background: `var(--cat-${cat.slice(1)})`,
                              }}
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

              {/* Getting started — option-card anatomy */}
              <div className="panel overflow-hidden">
                <div className="border-b border-border px-3 py-2">
                  <div className="text-[0.8125rem] font-medium">Getting started</div>
                </div>
                <Link
                  to="/sequences/new"
                  className="group flex items-center gap-3 border-b border-border px-3 py-3 hover:bg-[color:var(--paper-050)]"
                >
                  <Tile size="md" hue="brand" tint>
                    <Layers />
                  </Tile>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.8125rem] font-semibold leading-tight">
                      Create a sequence
                    </div>
                    <div className="text-[0.6875rem] text-muted-foreground">
                      Build a multi-step outbound cadence and enroll prospects
                    </div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--paper-300)] transition-colors group-hover:text-foreground" />
                </Link>
                <Link
                  to="/prospects/import"
                  className="group flex items-center gap-3 border-b border-border px-3 py-3 hover:bg-[color:var(--paper-050)]"
                >
                  <Tile size="md" hue="neutral" tint>
                    <Import />
                  </Tile>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.8125rem] font-semibold leading-tight">
                      Import prospects
                    </div>
                    <div className="text-[0.6875rem] text-muted-foreground">
                      Upload a CSV to populate your contact list
                    </div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--paper-300)] transition-colors group-hover:text-foreground" />
                </Link>
                <Link
                  to="/settings/mailboxes"
                  className="group flex items-center gap-3 px-3 py-3 hover:bg-[color:var(--paper-050)]"
                >
                  <Tile size="md" hue="neutral" tint>
                    <Mail />
                  </Tile>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.8125rem] font-semibold leading-tight">
                      Connect a mailbox
                    </div>
                    <div className="text-[0.6875rem] text-muted-foreground">
                      Link Gmail, Microsoft 365 or SMTP to start sending
                    </div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--paper-300)] transition-colors group-hover:text-foreground" />
                </Link>
              </div>
            </div>
          </section>

          {/* Sent vs replies — 30d */}
          <section className="mt-3 panel overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <div>
                <div className="text-[0.8125rem] font-medium">Sent vs replies · 30d</div>
                <div className="text-[0.6875rem] text-muted-foreground">
                  {formatCount(trendSent.reduce((a, b) => a + b, 0))} sent ·{" "}
                  {formatCount(trendReplies.reduce((a, b) => a + b, 0))} replies
                </div>
              </div>
            </div>
            {hasActivity ? (
              <div className="px-3 py-2.5">
                <div className="h-32">
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
                        tick={{
                          fontSize: 9,
                          fill: "var(--paper-500)",
                          fontFamily: "IBM Plex Mono",
                        }}
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
                <div className="mt-2 flex items-center gap-4 font-mono text-[0.625rem] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-px w-3 bg-[color:var(--paper-400)]" />
                    sent
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-px w-3 bg-foreground" />
                    replies
                  </span>
                </div>
              </div>
            ) : (
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
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ─── Empty state — shown when workspace has no data at all ─────────────── */
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
