import { auth } from "@quiksend/auth";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { authMiddleware } from "./org-fn.ts";
import {
  requireAdminOrOwner,
  selectPendingInvitations,
  toInvitationSummary,
} from "./invitations.server.ts";

const INVITABLE_ROLES = z.enum(["member", "admin"]);

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    requireAdminOrOwner(context.orgContext);
    const invitations = await auth.api.listInvitations({
      headers: context.authHeaders,
      query: { organizationId: context.orgContext.organizationId },
    });
    return selectPendingInvitations(invitations).map(toInvitationSummary);
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ email: z.string().email(), role: INVITABLE_ROLES }))
  .handler(async ({ data, context }) => {
    requireAdminOrOwner(context.orgContext);
    const invitation = await auth.api.createInvitation({
      headers: context.authHeaders,
      body: {
        email: data.email,
        role: data.role,
        organizationId: context.orgContext.organizationId,
      },
    });
    return toInvitationSummary(invitation);
  });

export const cancelInvitation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ invitationId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    requireAdminOrOwner(context.orgContext);
    await auth.api.cancelInvitation({
      headers: context.authHeaders,
      body: { invitationId: data.invitationId },
    });
    return { ok: true as const };
  });

/**
 * Accepts a pending invitation for the *currently signed-in* user. Deliberately
 * skipped by `authMiddleware` — a freshly invited user has no active
 * organization yet, so the tenancy chokepoint would reject them before they
 * ever get to join one. Better Auth's own `acceptInvitation` re-validates the
 * invitation (pending, unexpired, matches the caller's email) and sets it as
 * the caller's active organization.
 */
export const acceptInvitation = createServerFn({ method: "POST" })
  .validator(z.object({ invitationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) {
      throw new Error("Sign in before accepting an invitation");
    }
    const result = await auth.api.acceptInvitation({
      headers,
      body: { invitationId: data.invitationId },
    });
    if (!result?.invitation) {
      throw new Error(
        "Invitation could not be accepted — it may have expired or already been used",
      );
    }
    return { organizationId: result.invitation.organizationId };
  });
