import { Link, createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
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
import {
  getSequenceABCompare,
  getSequenceEventTimeline,
  getSequenceFunnel,
  getSequenceStepRates,
} from "@/lib/analytics.functions.ts";
import { getSequence as getSequenceMeta } from "@/lib/sequences.functions.ts";

export const Route = createFileRoute("/_protected/sequences/$id/analytics")({
  loader: async ({ params }) => {
    const [sequence, funnel, stepRates, abCompare, timeline] = await Promise.all([
      getSequenceMeta({ data: { id: params.id } }),
      getSequenceFunnel({ data: { sequenceId: params.id } }),
      getSequenceStepRates({ data: { sequenceId: params.id } }),
      getSequenceABCompare({ data: { sequenceId: params.id } }),
      getSequenceEventTimeline({ data: { sequenceId: params.id, limit: 30 } }),
    ]);
    return { sequence, funnel, stepRates, abCompare, timeline };
  },
  component: SequenceAnalyticsPage,
});

function SequenceAnalyticsPage() {
  const { sequence, funnel, stepRates, abCompare, timeline } = Route.useLoaderData();

  const funnelData = [
    { stage: "Enrolled", count: funnel.enrolled },
    { stage: "Sent", count: funnel.sent },
    { stage: "Replied", count: funnel.replied },
    { stage: "Bounced", count: funnel.bounced },
    { stage: "Completed", count: funnel.completed },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          to="/sequences/$id/enrollments"
          params={{ id: sequence.id }}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          ← Enrollments
        </Link>
        <h1 className="text-2xl font-semibold">{sequence.name} — Analytics</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funnel</CardTitle>
          <CardDescription>Enrollment outcomes for this sequence</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="stage" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-step rates</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Step</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Reply rate</TableHead>
                <TableHead className="text-right">Bounce rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stepRates.map((step) => (
                <TableRow key={step.stepIndex}>
                  <TableCell>{step.stepIndex + 1}</TableCell>
                  <TableCell>{step.stepType}</TableCell>
                  <TableCell className="text-right">{step.sent}</TableCell>
                  <TableCell className="text-right">{(step.replyRate * 100).toFixed(1)}%</TableCell>
                  <TableCell className="text-right">
                    {(step.bounceRate * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>A/B comparison</CardTitle>
          {abCompare.significance.note ? (
            <CardDescription>{abCompare.significance.note}</CardDescription>
          ) : (
            <CardDescription>
              Chi-square approximation (p ≈ {abCompare.significance.pValueApprox?.toFixed(2) ?? "—"}
              ){abCompare.significance.significant ? " — likely significant" : " — not significant"}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {abCompare.variants.map((v) => (
              <Card key={v.bucket}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Variant {v.bucket}</CardTitle>
                  <CardDescription>{v.total} enrollments</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>
                    Replied: {v.replied} ({(v.replyRate * 100).toFixed(1)}%)
                  </p>
                  <p>Completed: {v.completed}</p>
                  <p>Bounced: {v.bounced}</p>
                  <p>Active: {v.active}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {timeline.map((ev) => (
                <li key={ev.id} className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{ev.type}</Badge>
                  <span className="text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
