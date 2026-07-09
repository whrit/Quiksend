import Nango from "@nangohq/frontend";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicMailbox } from "@/lib/mailboxes.functions";
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
  const [configError, setConfigError] = useState<string | null>(null);

  const onSubmitSmtp = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setConfigError(null);
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
      const message = err instanceof Error ? err.message : "Failed to create mailbox";
      // Detect the specific env-config failure so the user sees an actionable
      // "set MAILBOX_ENCRYPTION_KEY" callout inline in the form instead of a
      // vanishing toast that reads like a random server error.
      if (message.includes("MAILBOX_ENCRYPTION_KEY")) {
        setConfigError(message);
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * OAuth-based mailbox connection. The address is captured server-side from
   * the provider's own profile endpoint (Gmail: users.getProfile; Microsoft:
   * Graph /me) once Nango finishes the flow, so we don't ask the user to type
   * it here. They just pick an account in the provider's consent screen.
   */
  const connectOAuthMailbox = async (kind: "gmail" | "microsoft"): Promise<void> => {
    setSubmitting(true);
    try {
      const session =
        kind === "gmail"
          ? await createGmailConnectSession()
          : await createMicrosoftConnectSession();
      const nango = new Nango({ host: "https://api.nango.dev" });
      const mailbox = await new Promise<PublicMailbox>((resolve, reject) => {
        const connect = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === "close") {
              reject(new Error("Connect UI closed"));
              return;
            }
            if (event.type === "connect") {
              const finalize = kind === "gmail" ? finalizeGmailMailbox : finalizeMicrosoftMailbox;
              void finalize({
                data: {
                  nangoConnectionId: event.payload.connectionId,
                  fromName: fromName || undefined,
                },
              })
                .then((created) => resolve(created))
                .catch(reject);
            }
          },
        });
        connect.setSessionToken(session.sessionToken);
      });
      toast.success(`Connected ${mailbox.address}`);
      void navigate({ to: "/settings/mailboxes" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect mailbox");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-6 fade-in">
      <header className="mb-4 border-b border-border pb-4">
        <div className="micro-label">New mailbox</div>
        <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
          Add mailbox
        </h1>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          Connect SMTP (Mailpit locally), Gmail, or Microsoft 365.
        </p>
      </header>

      <div className="mb-4 flex items-center gap-1.5">
        <ProviderChip active={provider === "smtp"} onClick={() => setProvider("smtp")}>
          SMTP
        </ProviderChip>
        <ProviderChip active={provider === "gmail"} onClick={() => setProvider("gmail")}>
          Gmail
        </ProviderChip>
        <ProviderChip active={provider === "microsoft"} onClick={() => setProvider("microsoft")}>
          Microsoft
        </ProviderChip>
      </div>

      {provider === "smtp" ? (
        <div className="panel p-4">
          <div className="mb-3">
            <div className="micro-label">SMTP settings</div>
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
              For local dev, use host <code className="font-mono text-[0.6875rem]">localhost</code>{" "}
              and port <code className="font-mono text-[0.6875rem]">1025</code> (Mailpit).
            </p>
          </div>
          {configError ? (
            <div className="mb-4 rounded-[3px] border border-destructive/50 bg-destructive/5 p-3 text-[0.75rem]">
              <div className="font-medium text-destructive">Server not configured</div>
              <p className="mt-1 text-destructive/80">{configError}</p>
              <p className="mt-2 text-[0.6875rem] text-muted-foreground">
                Generate a key with{" "}
                <code className="rounded-[3px] bg-[color:var(--paper-050)] px-1 py-0.5 font-mono">
                  openssl rand -base64 32
                </code>
                , add it to your{" "}
                <code className="rounded-[3px] bg-[color:var(--paper-050)] px-1 py-0.5 font-mono">
                  .env
                </code>{" "}
                as{" "}
                <code className="rounded-[3px] bg-[color:var(--paper-050)] px-1 py-0.5 font-mono">
                  MAILBOX_ENCRYPTION_KEY=…
                </code>
                , then restart the server.
              </p>
            </div>
          ) : null}
          <form onSubmit={(e) => void onSubmitSmtp(e)} className="space-y-3">
            <MailboxIdentityFields
              address={address}
              fromName={fromName}
              onAddressChange={setAddress}
              onFromNameChange={setFromName}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="host" className="text-[0.6875rem] font-medium">
                  SMTP host
                </Label>
                <Input id="host" required value={host} onChange={(e) => setHost(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="port" className="text-[0.6875rem] font-medium">
                  Port
                </Label>
                <Input
                  id="port"
                  type="number"
                  required
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="authUser" className="text-[0.6875rem] font-medium">
                  Username (optional)
                </Label>
                <Input
                  id="authUser"
                  autoComplete="off"
                  value={authUser}
                  onChange={(e) => setAuthUser(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="authPass" className="text-[0.6875rem] font-medium">
                  Password (optional)
                </Label>
                <Input
                  id="authPass"
                  type="password"
                  autoComplete="new-password"
                  value={authPass}
                  onChange={(e) => setAuthPass(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="dailyCap" className="text-[0.6875rem] font-medium">
                  Daily cap
                </Label>
                <Input
                  id="dailyCap"
                  type="number"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="throttle" className="text-[0.6875rem] font-medium">
                  Throttle (seconds)
                </Label>
                <Input
                  id="throttle"
                  type="number"
                  value={throttleSeconds}
                  onChange={(e) => setThrottleSeconds(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Connect mailbox"}
              </Button>
              <Link to="/settings/mailboxes" className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
            </div>
          </form>
        </div>
      ) : (
        <OAuthConnectPanel
          provider={provider}
          fromName={fromName}
          onFromNameChange={setFromName}
          submitting={submitting}
          onConnect={() => void connectOAuthMailbox(provider)}
        />
      )}
    </div>
  );
}

function ProviderChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "inline-flex h-7 items-center rounded-[3px] bg-foreground px-2.5 text-[0.75rem] font-medium text-background transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          : "inline-flex h-7 items-center rounded-[3px] border border-border bg-card px-2.5 text-[0.75rem] font-medium text-muted-foreground transition-colors duration-120 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      }
    >
      {children}
    </button>
  );
}

function OAuthConnectPanel({
  provider,
  fromName,
  onFromNameChange,
  submitting,
  onConnect,
}: {
  provider: "gmail" | "microsoft";
  fromName: string;
  onFromNameChange: (value: string) => void;
  submitting: boolean;
  onConnect: () => void;
}): React.ReactElement {
  const label = provider === "gmail" ? "Gmail" : "Microsoft 365";
  return (
    <div className="panel p-4">
      <div className="mb-3">
        <div className="micro-label">OAuth via Nango</div>
        <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
          Click below and pick your {label} account in the provider's window. We'll pull the mailbox
          address straight from the account you consent with.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fromName" className="text-[0.6875rem] font-medium">
          From name{" "}
          <span className="font-normal text-muted-foreground">(optional, display only)</span>
        </Label>
        <Input
          id="fromName"
          placeholder="Jane Doe"
          value={fromName}
          onChange={(e) => onFromNameChange(e.target.value)}
        />
      </div>

      <div className="mt-4 flex items-center gap-1.5">
        <Button type="button" size="lg" onClick={onConnect} disabled={submitting}>
          {submitting ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <Mail className="mr-1.5 h-3 w-3" />
          )}
          Continue with {label}
        </Button>
        <Link to="/settings/mailboxes" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
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
}): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="address" className="text-[0.6875rem] font-medium">
          Address
        </Label>
        <Input
          id="address"
          type="email"
          required
          autoComplete="email"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="fromName" className="text-[0.6875rem] font-medium">
          From name
        </Label>
        <Input
          id="fromName"
          placeholder="Jane Doe"
          value={fromName}
          onChange={(e) => onFromNameChange(e.target.value)}
        />
      </div>
    </div>
  );
}
