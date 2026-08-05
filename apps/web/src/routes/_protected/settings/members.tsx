import { Loader2, Mail, Plus, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

export const Route = createFileRoute("/_protected/settings/members/")({
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
      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail("");
      setRole("member");
      setInviteOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      await cancelInvitation({ data: { invitationId: cancelTarget.id } });
      await reload();
      toast.success("Invitation canceled");
      setCancelTarget(null);
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
          <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Members
          </h1>
          <p className="text-sm text-muted-foreground">
            Invite teammates to this workspace. New accounts are invitation-only.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
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
              <Button size="sm" onClick={() => setInviteOpen(true)}>
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
              <TableHead className="w-[120px]" />
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
              They&apos;ll receive an email with a link to create an account and join this
              workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
                onKeyDown={(e) => e.key === "Enter" && void handleInvite()}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[0.8125rem] font-semibold">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as InvitableRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button disabled={inviting || !email.trim()} onClick={() => void handleInvite()}>
              {inviting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-1 h-4 w-4" />
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
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Keep invitation
            </Button>
            <Button variant="destructive" disabled={canceling} onClick={() => void confirmCancel()}>
              {canceling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Cancel invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
