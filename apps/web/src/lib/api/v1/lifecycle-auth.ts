import { auth } from "@quiksend/auth";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq } from "drizzle-orm";
import { jsonError } from "./middleware.ts";

/**
 * Session-based (cookie) auth for organization lifecycle endpoints (export,
 * delete) — deliberately separate from `withApiAuth` (API-key bearer auth):
 * these are settings-page actions gated on the CALLER'S OWN session and role
 * in their own active workspace. No client-supplied `organizationId` is ever
 * accepted or trusted — the target organization is always the session's
 * `activeOrganizationId`, so a caller can never act on a workspace they
 * don't belong to (org B's session can only ever resolve to org B).
 */

export interface LifecycleSessionContext {
  organizationId: string;
  userId: string;
}

type MemberRole = "owner" | "admin" | "member";

type Resolved =
  | { error: Response }
  | { organizationId: string; userId: string; role: MemberRole; headers: Headers };

async function resolveActiveMembership(request: Request): Promise<Resolved> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { error: jsonError("UNAUTHORIZED", "No active session", 401) };

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    return { error: jsonError("NO_ACTIVE_WORKSPACE", "Session has no active workspace", 400) };
  }

  const membership = await db.query.member.findFirst({
    where: and(
      eq(tables.member.userId, session.user.id),
      eq(tables.member.organizationId, organizationId),
    ),
  });
  if (!membership) {
    return {
      error: jsonError("NOT_A_MEMBER", "Caller is not a member of the active workspace", 403),
    };
  }

  return {
    organizationId,
    userId: session.user.id,
    role: membership.role === "owner" || membership.role === "admin" ? membership.role : "member",
    headers: request.headers,
  };
}

/** Admin-or-owner session gate — used for organization data export. */
export async function withAdminSession(
  request: Request,
  handler: (ctx: LifecycleSessionContext) => Promise<Response>,
): Promise<Response> {
  const resolved = await resolveActiveMembership(request);
  if ("error" in resolved) return resolved.error;
  if (resolved.role !== "owner" && resolved.role !== "admin") {
    return jsonError("FORBIDDEN", "Admin or owner role required", 403);
  }
  return handler({ organizationId: resolved.organizationId, userId: resolved.userId });
}

/**
 * Owner-only session gate + fresh password reauthentication — used for
 * organization deletion. Verifies the password via Better Auth's own
 * `/verify-password` endpoint (session-scoped, no side effects, no new
 * session) rather than accepting or comparing a password hash ourselves.
 */
export async function withOwnerReauth(
  request: Request,
  password: string,
  handler: (ctx: LifecycleSessionContext) => Promise<Response>,
): Promise<Response> {
  const resolved = await resolveActiveMembership(request);
  if ("error" in resolved) return resolved.error;
  if (resolved.role !== "owner") {
    return jsonError("OWNER_REQUIRED", "Owner role required", 403);
  }

  const verification = await auth.api
    .verifyPassword({ body: { password }, headers: resolved.headers })
    .catch(() => null);
  if (!verification?.status) {
    return jsonError("REAUTH_REQUIRED", "Password verification failed", 401);
  }

  return handler({ organizationId: resolved.organizationId, userId: resolved.userId });
}
