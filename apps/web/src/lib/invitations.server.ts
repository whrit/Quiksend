import { isAdminOrOwner, type OrgContext } from "@quiksend/core";

/**
 * Pure helpers `invitations.functions.ts`'s `createServerFn` handlers
 * delegate to. Kept in a plain module (no `@tanstack/react-start` import) so
 * they're directly unit-testable — matching `organization.server.ts` /
 * `mailboxes.server.ts`'s split between server-fn wiring and testable logic.
 */

export interface InvitationSummary {
  readonly id: string;
  readonly email: string;
  readonly role: string | null;
  readonly status: string;
  readonly expiresAt: Date;
}

/** Throws unless the caller is an org admin or owner — every invite handler gates on this. */
export function requireAdminOrOwner(orgContext: OrgContext): void {
  if (!isAdminOrOwner(orgContext)) {
    throw new Error("Admin or owner role required to manage invitations");
  }
}

/** Narrows a Better Auth invitation row to the fields the UI is allowed to see. */
export function toInvitationSummary(invitation: {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
}): InvitationSummary {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Cancelled/accepted/rejected invitations are history, not actionable — the
 * members page only ever needs the ones still awaiting a response.
 */
export function selectPendingInvitations<T extends { status: string }>(invitations: readonly T[]): T[] {
  return invitations.filter((invitation) => invitation.status === "pending");
}
