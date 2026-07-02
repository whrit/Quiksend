import { auth } from "@quiksend/auth";
import { asOrganizationId, asUserId, type MemberRole, type OrgContext } from "@quiksend/core";
import { db, tables } from "@quiksend/db";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";

/**
 * `orgFn` — THE tenancy chokepoint. Every data-touching server function
 * composes `authMiddleware` and receives a validated `OrgContext` in
 * `ctx.orgContext`. Downstream queries MUST filter by `ctx.orgContext.organizationId`;
 * the CI tenancy guard in `packages/db/src/schema/*` will catch missing filters.
 *
 * The middleware:
 *   • pulls the Better Auth session from the incoming request headers
 *   • resolves the session's `activeOrganizationId` (workspace)
 *   • looks up the caller's `member.role` in that org (owner/admin/member)
 *   • throws with a stable code (`UNAUTHORIZED`, `NO_ACTIVE_WORKSPACE`,
 *     `NOT_A_MEMBER`) so callers can translate to redirects/403s uniformly
 *
 * Role gating helpers live on the returned `OrgContext` (see
 * `@quiksend/core` `isAdminOrOwner`) so every admin-only mutation checks it
 * one way.
 */

export class TenancyError extends Error {
  readonly code: "UNAUTHORIZED" | "NO_ACTIVE_WORKSPACE" | "NOT_A_MEMBER";
  constructor(code: TenancyError["code"], message: string) {
    super(message);
    this.name = "TenancyError";
    this.code = code;
  }
}

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session) throw new TenancyError("UNAUTHORIZED", "No active session");

  const activeOrganizationId = session.session.activeOrganizationId;
  if (!activeOrganizationId) {
    throw new TenancyError("NO_ACTIVE_WORKSPACE", "Session has no active workspace");
  }

  const membership = await db.query.member.findFirst({
    where: and(
      eq(tables.member.userId, session.user.id),
      eq(tables.member.organizationId, activeOrganizationId),
    ),
  });
  if (!membership)
    throw new TenancyError("NOT_A_MEMBER", "Caller is not a member of the active workspace");

  const orgContext: OrgContext = {
    userId: asUserId(session.user.id),
    organizationId: asOrganizationId(activeOrganizationId),
    role: normalizeRole(membership.role),
  };
  return next({ context: { orgContext } });
});

function normalizeRole(role: string): MemberRole {
  if (role === "owner" || role === "admin" || role === "member") return role;
  // Better Auth allows extra roles per plugin config; treat unknowns as least-privileged.
  return "member";
}

/** Shortcut for `createServerFn({...}).middleware([authMiddleware])`. */
export const orgFn = (options: { method: "GET" | "POST" }) =>
  createServerFn(options).middleware([authMiddleware]);
