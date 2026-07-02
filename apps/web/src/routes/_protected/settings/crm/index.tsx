import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createCrmConnectSession,
  disconnectCrm,
  finalizeCrmConnection,
  listCrmConnections,
  triggerCrmSync,
  type CrmConnectionDto,
} from "@/lib/crm.functions";
import Nango from "@nangohq/frontend";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_protected/settings/crm/")({
  component: CrmSettingsPage,
  loader: async () => listCrmConnections(),
});

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
