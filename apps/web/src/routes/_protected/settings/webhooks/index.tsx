import { SUPPORTED_WEBHOOK_EVENTS } from "@quiksend/db/schema";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await deleteWebhookEndpoint({ data: { id } });
      await reload();
      toast.success("Webhook deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete webhook");
    } finally {
      setBusy(false);
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
    <div className="space-y-6">
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
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.map((ep) => (
              <TableRow key={ep.id}>
                <TableCell className="max-w-xs truncate font-mono text-xs">{ep.url}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {ep.events.map((ev) => (
                      <Badge key={ev} variant="secondary">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{ep.status}</TableCell>
                <TableCell className="space-x-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleTest(ep.id)}
                  >
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => void handleDelete(ep.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {endpoints.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No webhook endpoints yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">URL</Label>
              <Input
                id="webhook-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/quiksend"
              />
            </div>
            <div className="space-y-2">
              <Label>Events</Label>
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
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
