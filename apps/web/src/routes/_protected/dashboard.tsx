import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Import,
  Inbox,
  MailPlus,
  PencilLine,
  Plus,
  Shield,
  Sparkles,
  Users,
  Webhook,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buttonVariants } from "@/components/ui/button";
import { getGatewayMixForOrg } from "@/lib/prospects.functions.ts";
import { getWorkspaceOverview } from "@/lib/analytics.functions.ts";
import { authClient } from "@/lib/auth-client";
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

const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** Strip a leading English article so "The Ledger" doesn't render as "The The Ledger". */
function stripArticle(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, "").trim();
}

/* ─── Editorial metric card ─────────────────────────────────────────────── */
function MetricCard({
  label,
  value,
  unit,
  to,
  delta,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  to?: string;
  delta?: { pct: number; direction: "up" | "down" | "flat" };
  className?: string;
}) {
  const content = (
    <div
      className={cn(
        "paper group relative flex flex-col justify-between p-5 min-h-[128px]",
        className,
      )}
    >
      <div className="micro-label">{label}</div>
      <div className="flex items-baseline gap-1.5 pt-6">
        <div className="font-display text-[3.75rem] leading-none tracking-[-0.03em] text-foreground tabular">
          {value}
        </div>
        {unit && (
          <div className="pb-2 font-mono text-[0.6875rem] font-medium uppercase tracking-widest text-muted-foreground">
            {unit}
          </div>
        )}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5 text-[0.6875rem]">
          <span
            className={cn(
              "font-mono font-medium tabular",
              delta.direction === "up" && "text-[color:var(--success)]",
              delta.direction === "down" && "text-[color:var(--destructive)]",
              delta.direction === "flat" && "text-muted-foreground",
            )}
          >
            {delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "·"}{" "}
            {Math.abs(delta.pct).toFixed(1)}%
          </span>
          <span className="text-muted-foreground">vs. last week</span>
        </div>
      )}
      {to && (
        <ArrowUpRight className="absolute right-4 top-4 h-3.5 w-3.5 text-[color:var(--ink-300)] transition-all group-hover:text-[color:var(--amber-600)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      )}
    </div>
  );
  if (to) return <Link to={to}>{content}</Link>;
  return content;
}

/* ─── Quick action tile ─────────────────────────────────────────────────── */
type QuickAction = {
  to: string;
  label: string;
  description: string;
  Icon: (props: { className?: string }) => React.ReactNode;
};

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    to: "/sequences/new",
    label: "New sequence",
    description: "Compose a multi-step outbound cadence",
    Icon: Plus,
  },
  {
    to: "/prospects/import",
    label: "Import prospects",
    description: "Bring in a CSV of contacts",
    Icon: Import,
  },
  { to: "/compose", label: "Compose", description: "Send a one-off message", Icon: PencilLine },
];

const SECONDARY_LINKS: readonly QuickAction[] = [
  { to: "/inbox", label: "Inbox", description: "Reply and triage responses", Icon: Inbox },
  {
    to: "/settings/mailboxes",
    label: "Mailboxes",
    description: "Connect Gmail, Microsoft, SMTP",
    Icon: MailPlus,
  },
  { to: "/settings/crm", label: "CRM sync", description: "Salesforce, HubSpot", Icon: Webhook },
  {
    to: "/settings/value-props",
    label: "Value props",
    description: "Position each product cleanly",
    Icon: Sparkles,
  },
  {
    to: "/settings/deliverability",
    label: "Deliverability",
    description: "Canary + SEG routing policy",
    Icon: Shield,
  },
  {
    to: "/settings/api-keys",
    label: "API keys",
    description: "For programmatic access",
    Icon: Users,
  },
];

function QuickActionCard({ action }: { action: QuickAction }) {
  return (
    <Link
      to={action.to}
      className="paper group relative flex flex-col gap-2 p-4 transition-all hover:-translate-y-[1px] hover:shadow-[0_0_0_1px_var(--border),0_2px_4px_rgba(20,15,5,0.04),0_8px_20px_-12px_rgba(20,15,5,0.1)]"
    >
      <div className="flex items-start justify-between">
        <span
          className="grid h-8 w-8 place-items-center rounded-md"
          style={{ background: "var(--ink-100)", color: "var(--ink-900)" }}
        >
          <action.Icon className="h-4 w-4" />
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-[color:var(--ink-300)] transition-all group-hover:text-[color:var(--amber-600)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <div>
        <div className="text-[0.8125rem] font-medium">{action.label}</div>
        <div className="mt-0.5 text-[0.75rem] text-muted-foreground">{action.description}</div>
      </div>
    </Link>
  );
}

/* ─── Character-filled empty state ──────────────────────────────────────── */
function EmptyStateBanner({ userName }: { userName: string }) {
  const first = userName.split(/[\s@]/)[0] || "there";
  return (
    <div className="paper relative overflow-hidden p-8">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-[0.06]"
        style={{ background: "var(--amber-600)" }}
      />
      <div className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 opacity-[0.04]">
        <svg width="280" height="280" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="34" stroke="currentColor" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="20" stroke="currentColor" strokeWidth="0.3" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.3" />
          <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeWidth="0.3" />
        </svg>
      </div>
      <div className="relative">
        <div className="micro-label">Welcome, {first}</div>
        <h1 className="mt-2 font-display text-[3rem] leading-[0.95] tracking-[-0.03em] text-foreground max-w-2xl">
          A blank workspace,{" "}
          <span className="font-display-italic text-[color:var(--amber-600)]">
            ready for the first line of copy
          </span>
          .
        </h1>
        <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-muted-foreground">
          Start by connecting a mailbox and importing prospects. Sequences build on top, canary
          sends monitor deliverability, and the inbox pulls it all back in.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link to="/settings/mailboxes" className={buttonVariants({ variant: "accent" })}>
            Connect mailbox
          </Link>
          <Link to="/prospects/import" className={buttonVariants({ variant: "outline" })}>
            Import prospects
          </Link>
          <Link to="/sequences/new" className={buttonVariants({ variant: "ghost" })}>
            or draft a sequence →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── The page ──────────────────────────────────────────────────────────── */
function Dashboard() {
  const { user } = ProtectedRoute.useRouteContext();
  const { data: active } = authClient.useActiveOrganization();
  const { overview, gatewayMix } = Route.useLoaderData();

  const isEmpty =
    overview.activeSequences === 0 &&
    overview.activeEnrollments === 0 &&
    overview.repliesThisWeek === 0 &&
    gatewayMix.mix.length === 0;

  const now = new Date();
  const bouncePct = (overview.bounceRate * 100).toFixed(1);
  const bounceDir: "up" | "down" | "flat" =
    overview.bounceRate === 0 ? "flat" : overview.bounceRate > 0.03 ? "up" : "down";

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      {/* Editorial masthead */}
      <header className="rise mb-10 flex items-end justify-between border-b border-border pb-6">
        <div>
          <div className="micro-label">{dateFmt.format(now)}</div>
          <h1 className="mt-2 font-display text-[2.5rem] leading-none tracking-[-0.025em]">
            <span className="font-display-italic text-foreground">
              {stripArticle(active?.name ?? "workspace")}
            </span>
            <span className="text-muted-foreground"> · Today</span>
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/prospects/import"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Import /> Import
          </Link>
          <Link to="/sequences/new" className={buttonVariants({ variant: "default", size: "sm" })}>
            <Plus /> New sequence
          </Link>
        </div>
      </header>

      {isEmpty ? (
        <div className="rise rise-2">
          <EmptyStateBanner userName={user.name || user.email} />
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_ACTIONS.map((action) => (
              <QuickActionCard key={action.to} action={action} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Big-number editorial grid */}
          <section className="rise rise-1 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Active sequences" value={overview.activeSequences} to="/sequences" />
            <MetricCard
              label="Enrollments"
              value={overview.activeEnrollments}
              unit="live"
              to="/sequences"
            />
            <MetricCard label="Replies · 7d" value={overview.repliesThisWeek} to="/inbox" />
            <MetricCard
              label="Bounce · 30d"
              value={bouncePct}
              unit="%"
              to="/deliverability"
              delta={{ pct: overview.bounceRate * 100, direction: bounceDir }}
            />
          </section>

          {/* Chart + Activity — split composition */}
          <section className="rise rise-2 mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="paper p-5">
              <div className="flex items-end justify-between">
                <div>
                  <div className="micro-label">Prospect gateway mix</div>
                  <div className="mt-1 font-display text-[1.5rem] leading-none tracking-tight">
                    {(gatewayMix.classifiedPct * 100).toFixed(0)}
                    <span className="font-mono text-[0.75rem] text-muted-foreground">
                      % classified
                    </span>
                  </div>
                </div>
                {gatewayMix.classifiedPct < 0.9 && (
                  <div className="text-[0.6875rem] text-muted-foreground">
                    classifying · refresh soon
                  </div>
                )}
              </div>
              <div className="mt-6 h-56">
                {gatewayMix.mix.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <p className="font-display-italic text-[1.125rem] text-muted-foreground">
                      No classified prospects yet.
                    </p>
                    <Link
                      to="/prospects/import"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Import prospects to classify →
                    </Link>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={gatewayMix.mix}
                      layout="vertical"
                      margin={{ left: 8, right: 24 }}
                    >
                      <XAxis type="number" hide domain={[0, "dataMax"]} />
                      <YAxis
                        type="category"
                        dataKey="gateway"
                        width={92}
                        tick={{ fontSize: 11, fill: "var(--ink-700)", fontFamily: "General Sans" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--ink-100)" }}
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "4px 8px",
                          fontSize: 12,
                          fontFamily: "JetBrains Mono",
                        }}
                        formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                      />
                      <Bar dataKey="pct" fill="var(--amber-600)" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Getting started ledger */}
            <div className="paper p-5">
              <div className="micro-label">Getting started</div>
              <div className="mt-3 space-y-2.5">
                {QUICK_ACTIONS.map((action, i) => (
                  <Link
                    key={action.to}
                    to={action.to}
                    className="group flex items-center gap-3 rounded-md py-2 pl-2 pr-1 transition-colors hover:bg-[color:var(--ink-100)]"
                  >
                    <span className="font-mono text-[0.6875rem] font-medium tabular text-muted-foreground">
                      0{i + 1}
                    </span>
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded"
                      style={{ background: "var(--ink-100)", color: "var(--ink-900)" }}
                    >
                      <action.Icon className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.8125rem] font-medium">{action.label}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">
                        {action.description}
                      </div>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 text-[color:var(--ink-300)] transition-all group-hover:text-[color:var(--amber-600)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* Explore more — quieter tile grid */}
          <section className="rise rise-3 mt-8">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="micro-label">Explore more</div>
              <Link
                to="/analytics"
                className="text-[0.75rem] text-muted-foreground hover:text-foreground"
              >
                Full analytics →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SECONDARY_LINKS.map((action) => (
                <QuickActionCard key={action.to} action={action} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
