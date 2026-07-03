import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEG_GATEWAY_VALUES } from "@/components/gateway-badge.tsx";
import { getSequenceDeliverabilityRisk } from "@/lib/organization.functions.ts";
import { getGatewayMixForSequence } from "@/lib/prospects.functions.ts";
import { getSequence } from "@/lib/sequences.functions.ts";

export const Route = createFileRoute("/_protected/sequences/$id/")({
  loader: async ({ params }) => {
    const [sequence, gatewayMix, sequenceRisk] = await Promise.all([
      getSequence({ data: { id: params.id } }),
      getGatewayMixForSequence({ data: { sequenceId: params.id } }),
      getSequenceDeliverabilityRisk({ data: { sequenceId: params.id } }),
    ]);
    return { sequence, gatewayMix, sequenceRisk };
  },
  component: SequenceDetailPage,
});

function SequenceDetailPage() {
  const { sequence, gatewayMix, sequenceRisk } = Route.useLoaderData();
  const [dismissed, setDismissed] = useState(false);

  const segProspects = gatewayMix.mix
    .filter((row) =>
      SEG_GATEWAY_VALUES.includes(row.gateway as (typeof SEG_GATEWAY_VALUES)[number]),
    )
    .reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/sequences/$id/edit"
          params={{ id: sequence.id }}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          ← Edit sequence
        </Link>
        <h1 className="text-2xl font-semibold">{sequence.name}</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/sequences/$id/enrollments"
          params={{ id: sequence.id }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Enrollments
        </Link>
        <Link
          to="/sequences/$id/analytics"
          params={{ id: sequence.id }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Analytics
        </Link>
        <Link
          to="/sequences/$id/enroll"
          params={{ id: sequence.id }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Enroll prospects
        </Link>
      </div>

      {sequenceRisk.showBanner && !dismissed && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Deliverability risk</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              This sequence enrolls {sequenceRisk.segProspectCount} prospect(s) at SEG-protected
              domains. None of your mailboxes are marked enterprise-safe.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/settings/deliverability" className={buttonVariants({ size: "sm" })}>
                Enable routing guard
              </Link>
              <Link
                to="/settings/mailboxes"
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                Configure mailboxes
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                Ignore
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Deliverability outlook</CardTitle>
          <CardDescription>
            SEG mix of enrolled prospects — {(gatewayMix.classifiedPct * 100).toFixed(0)}%
            classified
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {segProspects > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This sequence enrolls {segProspects} prospect(s) behind secure email gateways
              (Proofpoint, Mimecast, etc.). See Deliverability settings for routing options.
            </p>
          )}
          <div className="h-56">
            {gatewayMix.mix.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No enrolled prospects with gateways yet.
              </p>
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
