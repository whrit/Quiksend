import { auth } from "@quiksend/auth";
import { db, tables } from "@quiksend/db";
import { and, eq } from "drizzle-orm";

export type ProtectedAccessResult =
  | { ok: true; userId: string; email: string; name: string }
  | { ok: false; reason: "unauthenticated" | "no_workspace" | "not_member" };

export async function evaluateProtectedAccess(
  session: Awaited<ReturnType<typeof auth.api.getSession>>,
): Promise<ProtectedAccessResult> {
  if (!session) {
    return { ok: false, reason: "unauthenticated" };
  }

  const activeOrganizationId = session.session.activeOrganizationId;
  if (!activeOrganizationId) {
    return { ok: false, reason: "no_workspace" };
  }

  const membership = await db.query.member.findFirst({
    where: and(
      eq(tables.member.userId, session.user.id),
      eq(tables.member.organizationId, activeOrganizationId),
    ),
  });
  if (!membership) {
    return { ok: false, reason: "not_member" };
  }

  return {
    ok: true,
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}
