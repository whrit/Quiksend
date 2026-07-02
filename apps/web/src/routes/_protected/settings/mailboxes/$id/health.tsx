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
import { getMailboxHealthSummary, getMailboxVolume } from "@/lib/analytics.functions.ts";

export const Route = createFileRoute("/_protected/settings/mailboxes/$id/health")({
  loader: async ({ params }) => {
    const to = new Date();
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [summary, volume] = await Promise.all([
      getMailboxHealthSummary({ data: { mailboxId: params.id } }),
      getMailboxVolume({
        data: {
          mailboxId: params.id,
          from: from.toISOString(),
          to: to.toISOString(),
        },
      }),
    ]);
    return { summary, volume };
  },
  component: MailboxHealthPage,
});

function MailboxHealthPage() {
  const { summary, volume } = Route.useLoaderData();
  const { mailbox } = summary;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link to="/settings/mailboxes" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Mailboxes
        </Link>
        <h1 className="text-2xl font-semibold">{mailbox.address} — Health</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sent today</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {mailbox.sentToday} / {mailbox.dailyCap}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cap utilization</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {(mailbox.capUtilization * 100).toFixed(0)}%
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Bounce rate (30d)</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {(summary.bounceRate30d * 100).toFixed(1)}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Volume trend</CardTitle>
          <CardDescription>Hourly sends and bounces — last 30 days</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {volume.length === 0 ? (
            <p className="text-sm text-muted-foreground">No send activity in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volume}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sent" stroke="hsl(var(--primary))" name="Sent" />
                <Line type="monotone" dataKey="bounced" stroke="#dc2626" name="Bounced" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
