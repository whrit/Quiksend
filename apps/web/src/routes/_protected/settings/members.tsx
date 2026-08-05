import { Loader2, Mail, Plus, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Absent, EmptyState, Pill, SkeletonRows } from "@/components/ui/primitives.tsx";
import { formatDate, formatRelative } from "@/lib/semantic.ts";
import { cancelInvitation, inviteMember, listInvitations } from "@/lib/invitations.functions.ts";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/settings/members")({
  component: MembersPage,
});

type InvitationRow = Awaited<ReturnType<typeof listInvitations>>[number];
type InvitableRole = "member" | "admin";

function MembersPage() {
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [inviting, setInviting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<InvitationRow | null>(null);
  const [canceling, setCanceling] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setInvitations(await listInvitations({ data: {} }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load invitations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleInvite() {
    if (!email.trim()) return;
    setInviting(true);
    try {
      await inviteMember({ data: { email: email.trim(), role } });
      // Truthful: Better Auth's own background hook can swallow a delivery
      // enqueue failure (see packages/auth/src/auth.ts), so this only
      // claims what's actually confirmed — the invitation record exists.
      toast.success(`Invitation created for ${email.trim()}`);
      setEmail("");
      setRole("member");
      setInviteOpen(false);
      await reload();
      // The dialog's own trigger normally regains focus on close, but land
      // explicitly on the heading too — a stable target regardless of which
      // control (top button or empty-state button) opened the dialog.
      headingRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invitation");
    } finally {
      setInviting(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      await cancelInvitation({ data: { invitationId: cancelTarget.id } });
      // Close the dialog before reloading — Radix needs to unmount/release
      // its focus trap first, so the restoration below lands after that,
      // not on the about-to-be-removed row's Cancel button. Matches
      // handleInvite's ordering.
      setCancelTarget(null);
      await reload();
      toast.success("Invitation canceled");
      // The row (and its Cancel button) that had focus no longer exists
      // once the list reloads without it — land on the heading instead of
      // silently losing focus to <body>.
      headingRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel invitation");
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 fade-in w-full min-w-0">
      <div className="flex items-center justify-between">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-[3px]"
          >
            Members
          </h1>
          <p className="text-sm text-muted-foreground">
            Invite teammates to this workspace. New accounts are invitation-only.
          </p>
        </div>
        <Button type="button" onClick={() => setInviteOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Invite member
        </Button>
      </div>

      {loading ? (
        <div className="panel overflow-hidden">
          <SkeletonRows rows={3} cols={4} />
        </div>
      ) : invitations.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<UserPlus className="h-5 w-5" />}
            hue="brand"
            title="No pending invitations"
            body="Invite a teammate by email — they'll get a link to join this workspace."
            action={
              <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Invite member
              </Button>
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-[120px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-medium">{invitation.email}</TableCell>
                <TableCell>
                  <Pill tone="neutral">{invitation.role ?? "member"}</Pill>
                </TableCell>
                <TableCell>
                  <span title={formatDate(invitation.expiresAt) ?? undefined}>
                    {formatRelative(invitation.expiresAt) ?? <Absent />}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="text-[color:var(--neg)]"
                    aria-label={`Cancel invitation for ${invitation.email}`}
                    onClick={() => setCancelTarget(invitation)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ── Invite dialog ────────────────────────────────────────────────── */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            setEmail("");
            setRole("member");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              We&apos;ll queue an email with a link to create an account and join this workspace.
            </DialogDescription>
          </DialogHeader>
          <form
            id="invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleInvite();
            }}
            className="space-y-3"
          >
            <div className="space-y-1">
              <Label htmlFor="invite-email" className="text-[0.8125rem] font-semibold">
                Email <span className="text-[color:var(--neg)]">*</span>
              </Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                required
                aria-required="true"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role" className="text-[0.8125rem] font-semibold">
                Role
              </Label>
              <Select value={role} onValueChange={(v) => setRole(v as InvitableRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="invite-form"
              disabled={inviting || !email.trim()}
              aria-busy={inviting}
            >
              {inviting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Mail className="mr-1 h-4 w-4" aria-hidden="true" />
              )}
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel confirmation dialog ───────────────────────────────────── */}
      <Dialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel invitation?</DialogTitle>
            <DialogDescription>
              <strong>{cancelTarget?.email}</strong> won&apos;t be able to use this invitation
              link anymore. You can invite them again at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelTarget(null)}>
              Keep invitation
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={canceling}
              aria-busy={canceling}
              onClick={() => void confirmCancel()}
            >
              {canceling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Cancel invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
