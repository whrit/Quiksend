import Nango from "@nangohq/frontend";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Loader2, Mail, Plus, RefreshCw, RotateCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Absent, EmptyState, Pill, SkeletonRows, Tile } from "@/components/ui/primitives.tsx";
import {
  formatCount,
  healthLabel,
  healthTone,
  mailboxStatusTone,
  providerMeta,
} from "@/lib/semantic.ts";
import {
  checkMailboxHealth,
  createGmailReconnectSession,
  createMicrosoftReconnectSession,
  deleteMailbox,
  finalizeGmailMailbox,
  finalizeMicrosoftMailbox,
  listMailboxes,
  setMailboxEnterpriseSafe,
  testMailboxSend,
  type PublicMailbox,
} from "@/lib/mailboxes.functions";

export const Route = createFileRoute("/_protected/settings/mailboxes/")({
  component: MailboxesPage,
});

type MailboxRow = PublicMailbox;

/** Three individually-labelled SPF / DKIM / DMARC pills — greyscale-safe. */
function HealthPills({
  spf,
  dkim,
  dmarc,
}: {
  spf: boolean | null;
  dkim: boolean | null;
  dmarc: boolean | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {(
        [
          ["SPF", spf],
          ["DKIM", dkim],
          ["DMARC", dmarc],
        ] as const
      ).map(([name, ok]) => (
        <Pill key={name} tone={healthTone(ok)} dot>
          {name} {healthLabel(ok)}
        </Pill>
      ))}
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
  const [safeDialog, setSafeDialog] = useState<{
    id: string;
    address: string;
    enabling: boolean;
  } | null>(null);
  const [safeReason, setSafeReason] = useState("");
  const [safeSaving, setSafeSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; address: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const reconnectMailbox = useCallback(
    async (mb: MailboxRow): Promise<void> => {
      if (mb.provider !== "gmail" && mb.provider !== "microsoft") {
        toast.error("Reconnect is only supported for Gmail and Microsoft mailboxes");
        return;
      }
      setBusyId(mb.id);
      try {
        const session =
          mb.provider === "gmail"
            ? await createGmailReconnectSession({ data: { mailboxId: mb.id } })
            : await createMicrosoftReconnectSession({ data: { mailboxId: mb.id } });
        const nango = new Nango({ host: "https://api.nango.dev" });
        await new Promise<void>((resolve, reject) => {
          const connect = nango.openConnectUI({
            onEvent: (event) => {
              if (event.type === "close") reject(new Error("Connect UI closed"));
              if (event.type === "connect") {
                const finalize =
                  mb.provider === "gmail" ? finalizeGmailMailbox : finalizeMicrosoftMailbox;
                void finalize({
                  data: {
                    nangoConnectionId: event.payload.connectionId,
                    fromName: mb.fromName ?? undefined,
                  },
                })
                  .then(() => resolve())
                  .catch(reject);
              }
            },
          });
          connect.setSessionToken(session.sessionToken);
        });
        toast.success("Mailbox reconnected");
        await reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to reconnect mailbox");
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const confirmDelete = async () => {
    if (!deleteDialog) return;
    setDeleting(true);
    try {
      await deleteMailbox({ data: { id: deleteDialog.id } });
      toast.success("Mailbox deleted");
      setDeleteDialog(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete mailbox");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6 fade-in w-full min-w-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Mailboxes
          </h1>
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
        <div className="panel overflow-hidden">
          <SkeletonRows rows={4} cols={9} />
        </div>
      ) : mailboxes.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Mail className="h-5 w-5" />}
            hue="brand"
            title="No mailboxes connected"
            body="Quiksend sends from your own mailbox — connect Gmail, Microsoft or SMTP to start."
            action={
              <Link to="/settings/mailboxes/new" className={buttonVariants({ size: "sm" })}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add mailbox
              </Link>
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>From name</TableHead>
              <TableHead className="text-right">Daily cap</TableHead>
              <TableHead className="text-right">Throttle (s)</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Enterprise-safe</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mailboxes.map((mb) => {
              const pm = providerMeta(mb.provider);
              return (
                <TableRow key={mb.id}>
                  <TableCell className="max-w-[22ch] truncate font-medium" title={mb.address}>
                    {mb.address}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Tile size="sm" hue={pm.cat} tint>
                        {pm.label[0]}
                      </Tile>
                      <span>{pm.label}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[16ch] truncate" title={mb.fromName ?? undefined}>
                    {mb.fromName ? mb.fromName : <Absent>Not set</Absent>}
                  </TableCell>
                  <TableCell className="num text-right">
                    {mb.dailyCap != null ? formatCount(mb.dailyCap) : <Absent />}
                  </TableCell>
                  <TableCell className="num text-right">
                    {mb.throttleSeconds != null ? formatCount(mb.throttleSeconds) : <Absent />}
                  </TableCell>
                  <TableCell>
                    <HealthPills spf={mb.spfOk} dkim={mb.dkimOk} dmarc={mb.dmarcOk} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={mb.enterpriseSafe ? "default" : "outline"}
                      disabled={busyId === mb.id}
                      onClick={() =>
                        setSafeDialog({
                          id: mb.id,
                          address: mb.address,
                          enabling: !mb.enterpriseSafe,
                        })
                      }
                    >
                      {mb.enterpriseSafe ? "Safe" : "Not safe"}
                    </Button>
                    {mb.enterpriseSafeAutoDowngraded && (
                      <Pill tone="neg" dot className="ml-2">
                        Downgraded
                      </Pill>
                    )}
                  </TableCell>
                  <TableCell>
                    <Pill tone={mailboxStatusTone(mb.status)} dot>
                      {mb.status}
                    </Pill>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {mb.status === "error" &&
                        (mb.provider === "gmail" || mb.provider === "microsoft") && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Reconnect ${mb.address} via OAuth`}
                            disabled={busyId === mb.id}
                            onClick={() => void reconnectMailbox(mb)}
                          >
                            <RotateCw className="mr-1 h-3.5 w-3.5" />
                            Reconnect
                          </Button>
                        )}
                      <Link
                        to="/settings/mailboxes/$id/health"
                        params={{ id: mb.id }}
                        className={buttonVariants({ size: "icon", variant: "ghost" })}
                        aria-label={`View health for ${mb.address}`}
                        title="View health"
                      >
                        <Activity className="h-4 w-4" />
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Send test email from ${mb.address}`}
                        title="Test send"
                        onClick={() => setTestDialog({ id: mb.id, address: mb.address })}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Refresh health for ${mb.address}`}
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
                        {busyId === mb.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-[color:var(--neg)]"
                        aria-label={`Delete mailbox ${mb.address}`}
                        onClick={() => setDeleteDialog({ id: mb.id, address: mb.address })}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* ── Test send dialog ─────────────────────────────────────────────── */}
      <Dialog open={testDialog !== null} onOpenChange={(open) => !open && setTestDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test send</DialogTitle>
            <DialogDescription>
              Send a test message from {testDialog?.address} via Mailpit/SMTP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="test-email">
              Recipient email <span className="text-[color:var(--neg)]">*</span>
            </Label>
            <Input
              id="test-email"
              type="email"
              placeholder="you@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
            <p className="text-[0.6875rem] text-muted-foreground">
              A real message will be sent — use Mailpit or a test address.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialog(null)}>
              Cancel
            </Button>
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

      {/* ── Enterprise-safe dialog ───────────────────────────────────────── */}
      <Dialog open={safeDialog !== null} onOpenChange={(open) => !open && setSafeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {safeDialog?.enabling
                ? `Mark ${safeDialog.address} as enterprise-safe?`
                : `Remove enterprise-safe from ${safeDialog?.address}?`}
            </DialogTitle>
            {safeDialog?.enabling && (
              <DialogDescription className="space-y-2 text-left">
                <p>
                  Enterprise-safe mailboxes are used when Quiksend routes around SEGs (Proofpoint /
                  Mimecast / Barracuda). Consumer ESPs like Gmail are usually not enterprise-safe.
                </p>
                <ul className="list-inside list-disc text-sm">
                  <li>Aged Microsoft 365 tenant (6+ months): safe</li>
                  <li>Dedicated IP transactional relay (warmed): safe</li>
                  <li>Google Workspace: risky</li>
                  <li>Gmail: not safe</li>
                </ul>
                <p className="text-sm">
                  If deliverability drops, the canary system (Phase 11C) can auto-downgrade this
                  mailbox.
                </p>
              </DialogDescription>
            )}
          </DialogHeader>
          {safeDialog?.enabling && (
            <div className="space-y-2">
              <Label htmlFor="safe-reason">Reason (optional)</Label>
              <Input
                id="safe-reason"
                placeholder="M365 aged 6mo"
                value={safeReason}
                onChange={(e) => setSafeReason(e.target.value)}
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                Recorded in audit log. Helps justify the flag when reviewing deliverability.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSafeDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={safeSaving || !safeDialog}
              onClick={() => {
                if (!safeDialog) return;
                setSafeSaving(true);
                void setMailboxEnterpriseSafe({
                  data: {
                    mailboxId: safeDialog.id,
                    safe: safeDialog.enabling,
                    reason: safeDialog.enabling ? safeReason || undefined : undefined,
                  },
                })
                  .then(() => {
                    toast.success(
                      safeDialog.enabling
                        ? "Mailbox marked enterprise-safe"
                        : "Enterprise-safe removed",
                    );
                    setSafeDialog(null);
                    setSafeReason("");
                    return reload();
                  })
                  .catch((err: Error) => toast.error(err.message))
                  .finally(() => setSafeSaving(false));
              }}
            >
              {safeSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : safeDialog?.enabling ? (
                "Mark safe"
              ) : (
                "Remove"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ───────────────────────────────────── */}
      <Dialog open={deleteDialog !== null} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete mailbox?</DialogTitle>
            <DialogDescription>
              <strong>{deleteDialog?.address}</strong> will be permanently removed. Active sequences
              using this mailbox will fall back to workspace defaults.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Delete mailbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
