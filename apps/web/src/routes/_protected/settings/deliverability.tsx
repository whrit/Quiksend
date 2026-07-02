import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  getWorkspaceDeliverabilityPolicy,
  previewRoutingImpact,
  setWorkspaceDeliverabilityPolicy,
  type RoutingImpactPreview,
} from "@/lib/organization.functions.ts";

export const Route = createFileRoute("/_protected/settings/deliverability")({
  component: DeliverabilitySettingsPage,
});

type RoutingPolicy = "off" | "warn" | "enforce";

function RoutingSection() {
  const [policy, setPolicy] = useState<RoutingPolicy>("off");
  const [initialPolicy, setInitialPolicy] = useState<RoutingPolicy>("off");
  const [sanitizer, setSanitizer] = useState(true);
  const [preview, setPreview] = useState<RoutingImpactPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadPreview = useCallback(async () => {
    try {
      setPreview(await previewRoutingImpact());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load preview");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const current = await getWorkspaceDeliverabilityPolicy();
        setPolicy(current.routingPolicy);
        setInitialPolicy(current.routingPolicy);
        setSanitizer(current.contentSanitizerEnabled ?? current.routingPolicy !== "off");
        await loadPreview();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load policy");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPreview]);

  async function save() {
    setSaving(true);
    try {
      const updated = await setWorkspaceDeliverabilityPolicy({
        data: {
          routingPolicy: policy,
          contentSanitizerEnabled: sanitizer,
        },
      });
      setPolicy(updated.routingPolicy);
      setInitialPolicy(updated.routingPolicy);
      toast.success("Deliverability settings saved");
      await loadPreview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  function handleSaveClick() {
    if (initialPolicy === "off" && policy === "enforce") {
      setConfirmOpen(true);
      return;
    }
    void save();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Routing policy</h2>
        <p className="text-sm text-muted-foreground">
          Control how Quiksend routes sends to prospects behind SEGs (Proofpoint, Mimecast, etc.).
        </p>
      </div>

      <div className="space-y-3">
        {(
          [
            ["off", "Off (default)", "Send regardless; warnings only in UI"],
            ["warn", "Warn only", "Send but emit deliverability events when at risk"],
            ["enforce", "Enforce (auto-skip)", "Pause enrollments when no safe mailbox exists"],
          ] as const
        ).map(([value, title, description]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40"
          >
            <input
              type="radio"
              name="routingPolicy"
              className="mt-1"
              checked={policy === value}
              onChange={() => {
                setPolicy(value);
                void loadPreview();
              }}
            />
            <span>
              <span className="font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">{description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="sanitizer"
          checked={sanitizer}
          onCheckedChange={(checked) => setSanitizer(checked === true)}
        />
        <Label htmlFor="sanitizer">
          Strip tracking pixels and external images for SEG-destined sends
        </Label>
      </div>

      {preview && (
        <div className="rounded-md bg-muted/50 p-4 text-sm">
          <p>
            <strong>{preview.prospectsBehindSeg}</strong> prospects behind SEGs
          </p>
          <p>
            <strong>{preview.safeMailboxCount}</strong> enterprise-safe mailbox
            {preview.safeMailboxCount === 1 ? "" : "es"}
          </p>
          {preview.prospectsAtRiskOfSkip > 0 && policy === "enforce" && (
            <p className="mt-2 text-destructive">
              Enabling enforce would skip up to {preview.prospectsAtRiskOfSkip} enrollments until
              you add a safe mailbox.
            </p>
          )}
          {preview.prospectsPerGateway.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-muted-foreground">
              {preview.prospectsPerGateway.map((row) => (
                <li key={row.gateway}>
                  {row.gateway}: {row.count}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button disabled={saving} onClick={handleSaveClick}>
        {saving ? "Saving…" : "Save deliverability settings"}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable routing enforcement?</DialogTitle>
            <DialogDescription>
              Enforce mode pauses SEG-destined enrollments when no enterprise-safe mailbox exists.
              {preview && preview.safeMailboxCount === 0 && (
                <>
                  {" "}
                  You currently have <strong>0</strong> safe mailboxes — up to{" "}
                  {preview.prospectsAtRiskOfSkip} enrollments may pause immediately.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void save()} disabled={saving}>
              Enable enforce
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeliverabilitySettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Deliverability</h1>
        <p className="text-sm text-muted-foreground">
          Workspace-level routing and content sanitization for SEG-protected recipients.
        </p>
      </div>

      {/* === Phase 11B Routing section === */}
      <RoutingSection />
      {/* === End Phase 11B === */}

      {/* === Phase 11C Canary section (PHI extends here) === */}
    </div>
  );
}
