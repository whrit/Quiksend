import { SUPPORTED_WEBHOOK_EVENTS } from "@quiksend/db/schema";
import { Globe, Loader2, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Absent, EmptyState, Pill, SkeletonRows } from "@/components/ui/primitives.tsx";
import { connectionStatusTone, formatDate } from "@/lib/semantic.ts";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  triggerTestWebhookEvent,
} from "@/lib/webhooks.functions.ts";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/settings/webhooks/")({
  component: WebhooksPage,
});

type WebhookRow = Awaited<ReturnType<typeof listWebhookEndpoints>>[number];

function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.sent"]);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEndpoints(await listWebhookEndpoints({ data: {} }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await createWebhookEndpoint({
        data: { url: url.trim(), events: events as (typeof SUPPORTED_WEBHOOK_EVENTS)[number][] },
      });
      setUrl("");
      setDialogOpen(false);
      await reload();
      toast.success("Webhook endpoint created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteWebhookEndpoint({ data: { id: deleteTarget.id } });
      await reload();
      toast.success("Webhook deleted");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete webhook");
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest(id: string) {
    setBusy(true);
    try {
      await triggerTestWebhookEvent({
        data: { eventType: "message.sent", payload: { endpointId: id, test: true } },
      });
      toast.success("Test event queued");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trigger test event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 fade-in w-full min-w-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Webhooks
          </h1>
          <p className="text-sm text-muted-foreground">
            Receive HMAC-signed event payloads at your HTTPS endpoints.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add endpoint
        </Button>
      </div>

      {loading ? (
        <div className="panel overflow-hidden">
          <SkeletonRows rows={3} cols={4} />
        </div>
      ) : endpoints.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Globe className="h-5 w-5" />}
            hue="brand"
            title="No webhook endpoints"
            body="Add an HTTPS endpoint to receive real-time delivery and engagement events."
            action={
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add endpoint
              </Button>
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.map((ep) => (
              <TableRow key={ep.id}>
                <TableCell className="max-w-[28ch] truncate font-mono text-xs" title={ep.url}>
                  {ep.url}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {ep.events.map((ev) => (
                      <Pill key={ev} tone="neutral">
                        {ev}
                      </Pill>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Pill tone={connectionStatusTone(ep.status)} dot>
                    {ep.status}
                  </Pill>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(ep.createdAt) ?? <Absent>Unknown</Absent>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`Send test event to ${ep.url}`}
                      onClick={() => void handleTest(ep.id)}
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-[color:var(--neg)]"
                      disabled={busy}
                      aria-label={`Delete webhook endpoint ${ep.url}`}
                      onClick={() => setDeleteTarget(ep)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ── Add endpoint dialog ──────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="webhook-url" className="text-[0.8125rem] font-semibold">
                URL <span className="text-[color:var(--neg)]">*</span>
              </Label>
              <Input
                id="webhook-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/quiksend"
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                Must be HTTPS. Quiksend signs each request with HMAC-SHA256.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-[0.8125rem] font-semibold">
                Events <span className="text-[color:var(--neg)]">*</span>
              </Label>
              <p className="text-[0.6875rem] text-muted-foreground">
                Select at least one event to receive at this endpoint.
              </p>
              <div className="grid max-h-48 gap-2 overflow-y-auto">
                {SUPPORTED_WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={events.includes(ev)}
                      onCheckedChange={(checked) => {
                        setEvents((prev) =>
                          checked ? [...prev, ev] : prev.filter((e) => e !== ev),
                        );
                      }}
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !url.trim() || events.length === 0}
              onClick={() => void handleCreate()}
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ───────────────────────────────────── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete webhook endpoint?</DialogTitle>
            <DialogDescription>
              <strong className="font-mono text-xs">{deleteTarget?.url}</strong> will stop receiving
              events immediately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Delete endpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
