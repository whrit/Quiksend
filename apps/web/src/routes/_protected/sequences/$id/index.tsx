import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { getSequenceDeliverabilityRisk } from "@/lib/organization.functions.ts";

export const Route = createFileRoute("/_protected/sequences/$id/")({
  loader: async ({ params }) => {
    const sequenceRisk = await getSequenceDeliverabilityRisk({ data: { sequenceId: params.id } });
    return { sequenceRisk };
  },
  component: SequenceDetailPage,
});

function SequenceDetailPage() {
  const { id } = Route.useParams();
  const { sequenceRisk } = Route.useLoaderData();
  const [dismissed, setDismissed] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sequence overview</h1>
          <p className="text-sm text-muted-foreground">Deliverability outlook and quick actions</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/sequences/$id/edit"
            params={{ id }}
            className={buttonVariants({ variant: "outline" })}
          >
            Builder
          </Link>
          <Link to="/sequences/$id/enroll" params={{ id }} className={buttonVariants()}>
            Enroll
          </Link>
        </div>
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

      {/* Deliverability outlook panel — TAU extends with gateway mix */}
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        {sequenceRisk.segProspectCount > 0 ? (
          <p>
            {sequenceRisk.segProspectCount} enrolled prospect(s) behind SEGs ·{" "}
            {sequenceRisk.safeMailboxCount} enterprise-safe mailbox
            {sequenceRisk.safeMailboxCount === 1 ? "" : "es"}
          </p>
        ) : (
          <p>No SEG-tagged enrollments in this sequence yet.</p>
        )}
      </div>
    </div>
  );
}
