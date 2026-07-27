import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Absent, EmptyState, Pill } from "@/components/ui/primitives.tsx";
import { connectionStatusTone, formatRelative } from "@/lib/semantic.ts";
import {
  createCrmConnectSession,
  createHubspotReconnectSession,
  createSalesforceReconnectSession,
  disconnectCrm,
  finalizeCrmConnection,
  listCrmConnections,
  triggerCrmSync,
  type CrmConnectionDto,
} from "@/lib/crm.functions";
import { createList, listLists } from "@/lib/prospects.functions.ts";
import Nango from "@nangohq/frontend";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { Building2, Loader2, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_protected/settings/crm/")({
  component: CrmSettingsPage,
  loader: async () => listCrmConnections(),
});

type PullFilter = "all" | "modified_since" | "tagged";

function PullToListDialog({ connection }: { connection: CrmConnectionDto }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [targetListId, setTargetListId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [filter, setFilter] = useState<PullFilter>("all");
  const [modifiedSinceDays, setModifiedSinceDays] = useState("30");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listLists({ data: {} }).then((rows) => {
      setLists(rows.map((l) => ({ id: l.id, name: l.name })));
    });
  }, [open]);

  const handlePull = async () => {
    setBusy(true);
    try {
      let listId = targetListId;
      if (targetListId === "__new__") {
        if (!newListName.trim()) throw new Error("Enter a list name");
        const created = await createList({
          data: { name: newListName.trim(), description: `CRM pull from ${connection.provider}` },
        });
        listId = created.id;
      }
      if (!listId) throw new Error("Select a target list");

      await triggerCrmSync({
        data: {
          connectionId: connection.id,
          model: "Contact",
          targetListId: listId,
          filter,
          modifiedSinceDays: filter === "modified_since" ? Number(modifiedSinceDays) : undefined,
          tag: filter === "tagged" ? tag.trim() || undefined : undefined,
        },
      });
      toast.success("CRM contacts pull enqueued");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enqueue pull");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Pull contacts to list
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pull contacts to list</DialogTitle>
          <DialogDescription>
            Sync contacts from {connection.provider} into a Quiksend list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-[0.8125rem] font-semibold">
              Target list <span className="text-[color:var(--neg)]">*</span>
            </Label>
            <Select value={targetListId} onValueChange={setTargetListId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a list" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">Create new list…</SelectItem>
                {lists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetListId === "__new__" && (
              <Input
                placeholder="New list name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-[0.8125rem] font-semibold">Filter</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as PullFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All contacts</SelectItem>
                <SelectItem value="modified_since">Modified in last N days</SelectItem>
                <SelectItem value="tagged">Contacts tagged X</SelectItem>
              </SelectContent>
            </Select>
            {filter === "modified_since" && (
              <Input
                type="number"
                min={1}
                value={modifiedSinceDays}
                onChange={(e) => setModifiedSinceDays(e.target.value)}
                placeholder="Days"
              />
            )}
            {filter === "tagged" && (
              <Input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="Tag name (provider-dependent)"
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void handlePull()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {busy ? "Enqueuing…" : "Pull contacts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisconnectDialog({
  connection,
  onDisconnected,
}: {
  connection: CrmConnectionDto;
  onDisconnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await disconnectCrm({ data: { connectionId: connection.id } });
      toast.success("CRM disconnected");
      setOpen(false);
      onDisconnected();
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="text-[color:var(--neg)]">
          Disconnect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {connection.provider}?</DialogTitle>
          <DialogDescription>
            Contacts already synced remain in Quiksend but incremental syncs will stop. You can
            reconnect at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CrmSettingsPage() {
  const initial = Route.useLoaderData();
  const router = useRouter();
  const [connections, setConnections] = useState<CrmConnectionDto[]>(initial);
  const [connecting, setConnecting] = useState(false);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const rows = await listCrmConnections();
    setConnections(rows);
    await router.invalidate();
  }

  async function connectProvider(provider: "salesforce" | "hubspot"): Promise<void> {
    setConnecting(true);
    try {
      const session = await createCrmConnectSession({ data: provider });
      const nango = new Nango({ host: "https://api.nango.dev" });
      await new Promise<void>((resolve, reject) => {
        const connect = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === "close") reject(new Error("Connect UI closed"));
            if (event.type === "connect") {
              void finalizeCrmConnection({
                data: {
                  provider,
                  nangoConnectionId: event.payload.connectionId,
                },
              })
                .then(() => resolve())
                .catch(reject);
            }
          },
        });
        connect.setSessionToken(session.sessionToken);
      });
      toast.success("CRM connected");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect CRM";
      toast.error(message);
    } finally {
      setConnecting(false);
    }
  }

  async function reconnectProvider(conn: CrmConnectionDto): Promise<void> {
    setReconnectingId(conn.id);
    try {
      const session =
        conn.provider === "salesforce"
          ? await createSalesforceReconnectSession({ data: { crmConnectionId: conn.id } })
          : await createHubspotReconnectSession({ data: { crmConnectionId: conn.id } });
      const nango = new Nango({ host: "https://api.nango.dev" });
      await new Promise<void>((resolve, reject) => {
        const connect = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === "close") reject(new Error("Connect UI closed"));
            if (event.type === "connect") {
              void finalizeCrmConnection({
                data: {
                  provider: conn.provider,
                  nangoConnectionId: event.payload.connectionId,
                },
              })
                .then(() => resolve())
                .catch(reject);
            }
          },
        });
        connect.setSessionToken(session.sessionToken);
      });
      toast.success("CRM reconnected");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reconnect CRM");
    } finally {
      setReconnectingId(null);
    }
  }

  async function runSync(
    connectionId: string,
    model: "Contact" | "Account" | "Company",
  ): Promise<void> {
    try {
      await triggerCrmSync({ data: { connectionId, model } });
      toast.success("Sync enqueued");
    } catch {
      toast.error("Failed to enqueue sync");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6 fade-in w-full min-w-0">
      <div>
        <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
          CRM connections
        </h1>
        <p className="text-muted-foreground text-sm">
          Connect Salesforce or HubSpot to sync contacts and accounts into Quiksend.
        </p>
      </div>

      {connections.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            hue="brand"
            title="No CRM connected"
            body="Connect Salesforce or HubSpot to import contacts and sync on an incremental schedule."
            action={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={connecting}
                  onClick={() => void connectProvider("salesforce")}
                >
                  Connect Salesforce
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={connecting}
                  onClick={() => void connectProvider("hubspot")}
                >
                  Connect HubSpot
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => (
            <Card key={conn.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="capitalize">{conn.provider}</CardTitle>
                  <CardDescription>
                    Last sync:{" "}
                    {conn.lastSyncAt ? (
                      <span title={conn.lastSyncAt}>
                        {formatRelative(conn.lastSyncAt) ?? conn.lastSyncAt}
                      </span>
                    ) : (
                      <Absent>Never synced</Absent>
                    )}
                  </CardDescription>
                </div>
                <Pill tone={connectionStatusTone(conn.status)} dot>
                  {conn.status}
                </Pill>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {conn.status === "error" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reconnectingId === conn.id}
                    onClick={() => void reconnectProvider(conn)}
                  >
                    <RotateCw className="mr-1 h-3.5 w-3.5" />
                    Reconnect
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void runSync(conn.id, conn.provider === "hubspot" ? "Company" : "Account")
                  }
                >
                  Sync accounts
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runSync(conn.id, "Contact")}
                >
                  Sync contacts
                </Button>
                <PullToListDialog connection={conn} />
                <Link
                  to="/settings/crm/$connectionId/mapping"
                  params={{ connectionId: conn.id }}
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  Edit mapping
                </Link>
                <DisconnectDialog connection={conn} onDisconnected={() => void refresh()} />
              </CardContent>
            </Card>
          ))}
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={connecting}
              onClick={() => void connectProvider("salesforce")}
            >
              Connect Salesforce
            </Button>
            <Button
              variant="outline"
              disabled={connecting}
              onClick={() => void connectProvider("hubspot")}
            >
              Connect HubSpot
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
