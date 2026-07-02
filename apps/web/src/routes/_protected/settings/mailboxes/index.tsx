import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Mail, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  checkMailboxHealth,
  deleteMailbox,
  listMailboxes,
  testMailboxSend,
  type PublicMailbox,
} from "@/lib/mailboxes.functions";

export const Route = createFileRoute("/_protected/settings/mailboxes/")({
  component: MailboxesPage,
});

type MailboxRow = PublicMailbox;

function HealthDots({
  spf,
  dkim,
  dmarc,
}: {
  spf: boolean | null;
  dkim: boolean | null;
  dmarc: boolean | null;
}) {
  const dot = (ok: boolean | null, label: string) => (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok === null ? "bg-muted" : ok ? "bg-emerald-500" : "bg-red-500"}`}
      title={`${label}: ${ok === null ? "unchecked" : ok ? "pass" : "fail"}`}
    />
  );
  return (
    <div className="flex items-center gap-1.5" title="SPF / DKIM / DMARC">
      {dot(spf, "SPF")}
      {dot(dkim, "DKIM")}
      {dot(dmarc, "DMARC")}
    </div>
  );
}

function MailboxesPage() {
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [testDialog, setTestDialog] = useState<{ id: string; address: string } | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setMailboxes(await listMailboxes());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load mailboxes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mailboxes</h1>
          <p className="text-sm text-muted-foreground">
            Connect sending identities for one-off and sequence email.
          </p>
        </div>
        <Link to="/settings/mailboxes/new" className={buttonVariants()}>
          <Plus className="mr-2 h-4 w-4" />
          Add mailbox
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : mailboxes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Mail className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            No mailboxes yet. Add an SMTP mailbox to start sending.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>From name</TableHead>
              <TableHead>Daily cap</TableHead>
              <TableHead>Throttle (s)</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mailboxes.map((mb) => (
              <TableRow key={mb.id}>
                <TableCell className="font-medium">{mb.address}</TableCell>
                <TableCell className="capitalize">{mb.provider}</TableCell>
                <TableCell>{mb.fromName ?? "—"}</TableCell>
                <TableCell>{mb.dailyCap}</TableCell>
                <TableCell>{mb.throttleSeconds}</TableCell>
                <TableCell>
                  <HealthDots spf={mb.spfOk} dkim={mb.dkimOk} dmarc={mb.dmarcOk} />
                </TableCell>
                <TableCell>
                  <Badge variant={mb.status === "active" ? "default" : "secondary"}>
                    {mb.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Test send"
                      onClick={() => setTestDialog({ id: mb.id, address: mb.address })}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Refresh health"
                      disabled={busyId === mb.id}
                      onClick={() => {
                        setBusyId(mb.id);
                        void checkMailboxHealth({ data: { id: mb.id } })
                          .then(() => {
                            toast.success("Health check complete");
                            return reload();
                          })
                          .catch((err: Error) => toast.error(err.message))
                          .finally(() => setBusyId(null));
                      }}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete"
                      onClick={() => {
                        if (!confirm(`Delete mailbox ${mb.address}?`)) return;
                        setBusyId(mb.id);
                        void deleteMailbox({ data: { id: mb.id } })
                          .then(() => {
                            toast.success("Mailbox deleted");
                            return reload();
                          })
                          .catch((err: Error) => toast.error(err.message))
                          .finally(() => setBusyId(null));
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={testDialog !== null} onOpenChange={(open) => !open && setTestDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test send</DialogTitle>
            <DialogDescription>
              Send a test message from {testDialog?.address} via Mailpit/SMTP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="test-email">Recipient email</Label>
            <Input
              id="test-email"
              type="email"
              placeholder="you@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!testEmail || testSending}
              onClick={() => {
                if (!testDialog) return;
                setTestSending(true);
                void testMailboxSend({ data: { id: testDialog.id, toEmail: testEmail } })
                  .then((result) => {
                    toast.success(`Test sent — Message-Id ${result.messageId}`);
                    setTestDialog(null);
                    setTestEmail("");
                  })
                  .catch((err: Error) => toast.error(err.message))
                  .finally(() => setTestSending(false));
              }}
            >
              {testSending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
