import Nango from "@nangohq/frontend";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createGmailConnectSession,
  createMicrosoftConnectSession,
  createSmtpMailbox,
  finalizeGmailMailbox,
  finalizeMicrosoftMailbox,
} from "@/lib/mailboxes.functions";

type ProviderTab = "smtp" | "gmail" | "microsoft";

export const Route = createFileRoute("/_protected/settings/mailboxes/new")({
  component: NewMailboxPage,
});

function NewMailboxPage() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState<ProviderTab>("smtp");
  const [address, setAddress] = useState("sender@localhost");
  const [fromName, setFromName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("1025");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [dailyCap, setDailyCap] = useState("50");
  const [throttleSeconds, setThrottleSeconds] = useState("90");
  const [submitting, setSubmitting] = useState(false);

  const onSubmitSmtp = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await createSmtpMailbox({
        data: {
          address,
          fromName: fromName || undefined,
          host,
          port: Number(port),
          auth: authUser && authPass ? { user: authUser, pass: authPass } : undefined,
          dailyCap: Number(dailyCap),
          throttleSeconds: Number(throttleSeconds),
        },
      });
      toast.success("SMTP mailbox connected");
      void navigate({ to: "/settings/mailboxes" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create mailbox");
    } finally {
      setSubmitting(false);
    }
  };

  const connectOAuthMailbox = async (kind: "gmail" | "microsoft"): Promise<void> => {
    if (!address) {
      toast.error("Enter the mailbox address first");
      return;
    }
    setSubmitting(true);
    try {
      const session =
        kind === "gmail"
          ? await createGmailConnectSession()
          : await createMicrosoftConnectSession();
      const nango = new Nango({ host: "https://api.nango.dev" });
      await new Promise<void>((resolve, reject) => {
        const connect = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === "close") reject(new Error("Connect UI closed"));
            if (event.type === "connect") {
              const finalize = kind === "gmail" ? finalizeGmailMailbox : finalizeMicrosoftMailbox;
              void finalize({
                data: {
                  nangoConnectionId: event.payload.connectionId,
                  address,
                  fromName: fromName || undefined,
                },
              })
                .then(() => resolve())
                .catch(reject);
            }
          },
        });
        connect.setSessionToken(session.sessionToken);
      });
      toast.success(`${kind === "gmail" ? "Gmail" : "Microsoft"} mailbox connected`);
      void navigate({ to: "/settings/mailboxes" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect mailbox");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add mailbox</h1>
        <p className="text-sm text-muted-foreground">
          Connect SMTP (Mailpit locally), Gmail, or Microsoft 365.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={provider === "smtp" ? "default" : "outline"}
          onClick={() => setProvider("smtp")}
        >
          SMTP
        </Button>
        <Button
          type="button"
          variant={provider === "gmail" ? "default" : "outline"}
          onClick={() => setProvider("gmail")}
        >
          Gmail
        </Button>
        <Button
          type="button"
          variant={provider === "microsoft" ? "default" : "outline"}
          onClick={() => setProvider("microsoft")}
        >
          Microsoft
        </Button>
      </div>

      {provider === "smtp" ? (
        <Card>
          <CardHeader>
            <CardTitle>SMTP settings</CardTitle>
            <CardDescription>
              For local dev, use host <code className="text-xs">localhost</code> and port{" "}
              <code className="text-xs">1025</code> (Mailpit).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void onSubmitSmtp(e)} className="space-y-4">
              <MailboxIdentityFields
                address={address}
                fromName={fromName}
                onAddressChange={setAddress}
                onFromNameChange={setFromName}
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="host">SMTP host</Label>
                  <Input
                    id="host"
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    required
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="authUser">Username (optional)</Label>
                  <Input
                    id="authUser"
                    autoComplete="off"
                    value={authUser}
                    onChange={(e) => setAuthUser(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="authPass">Password (optional)</Label>
                  <Input
                    id="authPass"
                    type="password"
                    autoComplete="new-password"
                    value={authPass}
                    onChange={(e) => setAuthPass(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dailyCap">Daily cap</Label>
                  <Input
                    id="dailyCap"
                    type="number"
                    value={dailyCap}
                    onChange={(e) => setDailyCap(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="throttle">Throttle (seconds)</Label>
                  <Input
                    id="throttle"
                    type="number"
                    value={throttleSeconds}
                    onChange={(e) => setThrottleSeconds(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect mailbox"}
                </Button>
                <Link to="/settings/mailboxes" className={buttonVariants({ variant: "outline" })}>
                  Cancel
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{provider === "gmail" ? "Gmail" : "Microsoft 365"}</CardTitle>
            <CardDescription>
              OAuth via Nango. Use the same address as your connected account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MailboxIdentityFields
              address={address}
              fromName={fromName}
              onAddressChange={setAddress}
              onFromNameChange={setFromName}
            />
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void connectOAuthMailbox(provider)}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Connect ${provider === "gmail" ? "Gmail" : "Microsoft"}`
                )}
              </Button>
              <Link to="/settings/mailboxes" className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MailboxIdentityFields({
  address,
  fromName,
  onAddressChange,
  onFromNameChange,
}: {
  address: string;
  fromName: string;
  onAddressChange: (value: string) => void;
  onFromNameChange: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="address">From address</Label>
        <Input
          id="address"
          type="email"
          required
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fromName">From name</Label>
        <Input id="fromName" value={fromName} onChange={(e) => onFromNameChange(e.target.value)} />
      </div>
    </>
  );
}
