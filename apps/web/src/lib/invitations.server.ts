import { isAdminOrOwner, type OrgContext } from "@quiksend/core";

/** Pure helpers for invitations.functions.ts, split out for direct unit testability. */

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
  const { id, email, role, status, expiresAt } = invitation;
  return { id, email, role, status, expiresAt };
}

/**
 * Cancelled/accepted/rejected invitations are history, not actionable — the
 * members page only ever needs the ones still awaiting a response.
 */
export function selectPendingInvitations<T extends { status: string }>(invitations: readonly T[]): T[] {
  return invitations.filter((invitation) => invitation.status === "pending");
}
