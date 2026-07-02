import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSmtpMailbox } from "@/lib/mailboxes.functions";

export const Route = createFileRoute("/_protected/settings/mailboxes/new")({
  component: NewMailboxPage,
});

function NewMailboxPage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("sender@localhost");
  const [fromName, setFromName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("1025");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [dailyCap, setDailyCap] = useState("50");
  const [throttleSeconds, setThrottleSeconds] = useState("90");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
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

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add mailbox</h1>
        <p className="text-sm text-muted-foreground">
          Wave 1 supports SMTP (Mailpit locally). Gmail and Microsoft arrive in Wave 2.
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="default">
          SMTP
        </Button>
        <Button type="button" variant="outline" disabled title="Coming in Wave 2">
          Gmail
        </Button>
        <Button type="button" variant="outline" disabled title="Coming in Wave 2">
          Microsoft
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SMTP settings</CardTitle>
          <CardDescription>
            For local dev, use host <code className="text-xs">localhost</code> and port{" "}
            <code className="text-xs">1025</code> (Mailpit).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address">From address</Label>
              <Input
                id="address"
                type="email"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fromName">From name</Label>
              <Input id="fromName" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="host">SMTP host</Label>
                <Input id="host" required value={host} onChange={(e) => setHost(e.target.value)} />
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
    </div>
  );
}
