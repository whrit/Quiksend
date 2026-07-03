import { auth } from "@quiksend/auth";
import { asOrganizationId, asUserId, type MemberRole, type OrgContext } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";

/**
 * `authMiddleware` — THE tenancy chokepoint. Every data-touching server function
 * composes it (via `createServerFn(...).middleware([authMiddleware])`) and receives
 * a validated `OrgContext` in `ctx.orgContext`, plus the raw Better Auth headers
 * in `ctx.authHeaders` for handlers that need to re-issue `auth.api.*` calls.
 *
 * Downstream queries MUST filter by `ctx.orgContext.organizationId`; the CI
 * tenancy guard in `packages/db/src/schema/*` will catch missing filters.
 *
 * Why not wrap this in a helper like `orgFn(...)`? The TanStack Start Vite plugin's
 * AST detector recognizes bare `createServerFn(...)` at module top-level as an RPC
 * boundary and splits the client bundle accordingly. A wrapper hides that shape
 * and leaks server-only imports (`@quiksend/db`, `@quiksend/config`, `@quiksend/auth`)
 * into the browser bundle. Keep the `.middleware([authMiddleware])` chain explicit.
 *
 * The middleware:
 *   • pulls the Better Auth session from the incoming request headers
 *   • resolves the session's `activeOrganizationId` (workspace)
 *   • looks up the caller's `member.role` in that org (owner/admin/member)
 *   • throws with a stable code (`UNAUTHORIZED`, `NO_ACTIVE_WORKSPACE`,
 *     `NOT_A_MEMBER`) so callers can translate to redirects/403s uniformly
 *
 * Role gating helpers live on the returned `OrgContext` (see `@quiksend/core`
 * `isAdminOrOwner`) so every admin-only mutation checks it one way.
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
  return next({ context: { orgContext, authHeaders: headers } });
});

function normalizeRole(role: string): MemberRole {
  if (role === "owner" || role === "admin" || role === "member") return role;
  // Better Auth allows extra roles per plugin config; treat unknowns as least-privileged.
  return "member";
}
