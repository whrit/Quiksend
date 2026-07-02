import { Link, createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSequenceDeliverability } from "@/lib/deliverability.functions.ts";
import { getSequence } from "@/lib/sequences.functions.ts";

export const Route = createFileRoute("/_protected/sequences/$id/")({
  loader: async ({ params }) => {
    const sequence = await getSequence({ data: { id: params.id } });
    return { sequence };
  },
  component: SequenceDetailPage,
});

function SequenceDetailPage() {
  const { sequence } = Route.useLoaderData();
  const [live, setLive] = useState<Awaited<ReturnType<typeof getSequenceDeliverability>> | null>(
    null,
  );

  useEffect(() => {
    const load = () =>
      void getSequenceDeliverability({ data: { sequenceId: sequence.id } }).then(setLive);
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [sequence.id]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/sequences" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Sequences
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
          to="/sequences/$id/edit"
          params={{ id: sequence.id }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Edit
        </Link>
        <Link to="/deliverability" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Deliverability grid
        </Link>
      </div>

      {/* === Phase 11C live deliverability indicator (PHI) === */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live campaign deliverability</CardTitle>
        </CardHeader>
        <CardContent>
          {!live ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : live.sampleSize === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recent canary signal for this campaign (last 2 hours).
            </p>
          ) : (
            <p className="text-lg font-medium">
              Live deliverability for this campaign: {live.deliverabilityPct ?? "—"}%
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({live.sampleSize} canaries)
              </span>
            </p>
          )}
          {live?.belowThreshold && (
            <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              Auto-pause armed. Delivery rate has dropped below {live.threshold}%. Review at{" "}
              <Link to="/deliverability" className="underline">
                deliverability
              </Link>
              .
            </p>
          )}
          {live?.autoPaused && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              This campaign was auto-paused due to canary deliverability breach.
            </p>
          )}
        </CardContent>
      </Card>
      {/* === End Phase 11C === */}
    </div>
  );
}
