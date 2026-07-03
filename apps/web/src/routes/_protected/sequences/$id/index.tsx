import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { AlertTriangle, Shield } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEG_GATEWAY_VALUES } from "@/components/gateway-badge.tsx";
import { getSequenceDeliverability } from "@/lib/deliverability.functions.ts";
import { getSequenceDeliverabilityRisk } from "@/lib/organization.functions.ts";
import { getGatewayMixForSequence } from "@/lib/prospects.functions.ts";
import { getSequence, listEnrollments, resumeEnrollment } from "@/lib/sequences.functions.ts";

export const Route = createFileRoute("/_protected/sequences/$id/")({
  loader: async ({ params }) => {
    const [sequence, gatewayMix, sequenceRisk, liveDeliverability] = await Promise.all([
      getSequence({ data: { id: params.id } }),
      getGatewayMixForSequence({ data: { sequenceId: params.id } }),
      getSequenceDeliverabilityRisk({ data: { sequenceId: params.id } }),
      getSequenceDeliverability({ data: { sequenceId: params.id } }),
    ]);
    return { sequence, gatewayMix, sequenceRisk, liveDeliverability };
  },
  component: SequenceDetailPage,
});

const LIVE_SIGNAL_CLASS = {
  green: "bg-emerald-500/20 text-emerald-800 border-emerald-200",
  yellow: "bg-amber-500/20 text-amber-900 border-amber-200",
  red: "bg-red-500/20 text-red-900 border-red-200",
  insufficient_data: "bg-muted text-muted-foreground border-border",
} as const;

function liveSignal(pct: number | null, sampleSize: number): keyof typeof LIVE_SIGNAL_CLASS {
  if (sampleSize < 1 || pct === null) return "insufficient_data";
  if (pct >= 90) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

function SequenceDetailPage() {
  const router = useRouter();
  const { sequence, gatewayMix, sequenceRisk, liveDeliverability } = Route.useLoaderData();
  const [dismissed, setDismissed] = useState(false);
  const [autoPauseDismissed, setAutoPauseDismissed] = useState(false);
  const [resuming, setResuming] = useState(false);
  const autoPauseToastShown = useRef(false);

  const segProspects = gatewayMix.mix
    .filter((row) =>
      SEG_GATEWAY_VALUES.includes(row.gateway as (typeof SEG_GATEWAY_VALUES)[number]),
    )
    .reduce((sum, row) => sum + row.count, 0);

  const signal = liveSignal(liveDeliverability.deliverabilityPct, liveDeliverability.sampleSize);

  useEffect(() => {
    const id = setInterval(() => void router.invalidate(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    if (liveDeliverability.autoPaused && !autoPauseDismissed && !autoPauseToastShown.current) {
      autoPauseToastShown.current = true;
      toast.error("Auto-paused: canary threshold breached", {
        description: "Review deliverability and resume when ready.",
        action: {
          label: "Deliverability grid",
          onClick: () => router.navigate({ to: "/deliverability" }),
        },
      });
    }
  }, [liveDeliverability.autoPaused, autoPauseDismissed, router]);

  const handleResumeSequence = useCallback(async () => {
    setResuming(true);
    try {
      const enrollments = await listEnrollments({ data: { sequenceId: sequence.id } });
      const paused = enrollments.filter((e) => e.state === "paused");
      if (paused.length === 0) {
        toast.info("No paused enrollments to resume");
        return;
      }
      await Promise.all(paused.map((e) => resumeEnrollment({ data: { id: e.id } })));
      toast.success(`Resumed ${paused.length} enrollment(s)`);
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resume sequence");
    } finally {
      setResuming(false);
    }
  }, [router, sequence.id]);

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

      {liveDeliverability.autoPaused && !autoPauseDismissed && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Auto-paused: canary threshold breached</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Deliverability dropped below the {liveDeliverability.threshold}% threshold.
              Enrollments are paused until you review and resume.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/deliverability" className={buttonVariants({ size: "sm" })}>
                Deliverability grid
              </Link>
              <Button
                size="sm"
                variant="secondary"
                disabled={resuming}
                onClick={() => void handleResumeSequence()}
              >
                {resuming ? "Resuming…" : "Resume sequence"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAutoPauseDismissed(true)}>
                Dismiss banner
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

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
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Live deliverability
          </CardTitle>
          <CardDescription>Canary inbox arrival rate — refreshes every 30 seconds</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className={LIVE_SIGNAL_CLASS[signal]}>
              {signal === "insufficient_data"
                ? "Insufficient data"
                : `${liveDeliverability.deliverabilityPct}% inbox`}
            </Badge>
            <span className="text-sm text-muted-foreground">
              last 2h · {liveDeliverability.sampleSize} canar
              {liveDeliverability.sampleSize === 1 ? "y" : "ies"}
            </span>
            {liveDeliverability.belowThreshold && !liveDeliverability.autoPaused && (
              <span className="text-sm text-amber-700">
                Below {liveDeliverability.threshold}% threshold
              </span>
            )}
          </div>
        </CardContent>
      </Card>

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
