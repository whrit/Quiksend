import { Badge } from "@/components/ui/badge";
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
import {
  createCrmConnectSession,
  disconnectCrm,
  finalizeCrmConnection,
  listCrmConnections,
  triggerCrmSync,
  type CrmConnectionDto,
} from "@/lib/crm.functions";
import { createList, listLists } from "@/lib/prospects.functions.ts";
import Nango from "@nangohq/frontend";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
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
          <div className="space-y-2">
            <Label>Target list</Label>
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
          <div className="space-y-2">
            <Label>Filter</Label>
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
            {busy ? "Enqueuing…" : "Pull contacts"}
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

  async function disconnect(connectionId: string): Promise<void> {
    try {
      await disconnectCrm({ data: { connectionId } });
      toast.success("CRM disconnected");
      await refresh();
    } catch {
      toast.error("Failed to disconnect");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">CRM connections</h1>
        <p className="text-muted-foreground text-sm">
          Connect Salesforce or HubSpot to sync contacts and accounts into Quiksend.
        </p>
      </div>

      {connections.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No CRM connected</CardTitle>
            <CardDescription>
              Connect a CRM to import contacts and companies on an incremental schedule.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button disabled={connecting} onClick={() => void connectProvider("salesforce")}>
              Connect Salesforce
            </Button>
            <Button
              variant="outline"
              disabled={connecting}
              onClick={() => void connectProvider("hubspot")}
            >
              Connect HubSpot
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => (
            <Card key={conn.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="capitalize">{conn.provider}</CardTitle>
                  <CardDescription>
                    Last sync:{" "}
                    {conn.lastSyncAt ? new Date(conn.lastSyncAt).toLocaleString() : "Never"}
                  </CardDescription>
                </div>
                <Badge variant={conn.status === "active" ? "default" : "secondary"}>
                  {conn.status}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
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
                <Button size="sm" variant="destructive" onClick={() => void disconnect(conn.id)}>
                  Disconnect
                </Button>
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
