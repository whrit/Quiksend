import "@tanstack/react-start/server-only";

import { auth } from "@quiksend/auth";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, desc, eq } from "drizzle-orm";

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

/** Most recent workspace the user still belongs to (used when active org is stale). */
export async function findAccessibleOrganizationId(userId: string): Promise<string | null> {
  const membership = await db.query.member.findFirst({
    where: eq(tables.member.userId, userId),
    orderBy: [desc(tables.member.createdAt)],
    columns: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

export type OnboardingPrepResult =
  | { action: "redirect"; to: "/login" | "/dashboard" }
  | { action: "stay"; removedFromWorkspace: boolean };

export async function prepareOnboardingAccess(headers: Headers): Promise<OnboardingPrepResult> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return { action: "redirect", to: "/login" };
  }

  const access = await evaluateProtectedAccess(session);
  if (access.ok) {
    return { action: "redirect", to: "/dashboard" };
  }

  if (access.reason === "not_member") {
    const fallbackOrgId = await findAccessibleOrganizationId(session.user.id);
    if (fallbackOrgId) {
      await auth.api.setActiveOrganization({
        body: { organizationId: fallbackOrgId },
        headers,
      });
      return { action: "redirect", to: "/dashboard" };
    }

    await auth.api.setActiveOrganization({
      body: { organizationId: null },
      headers,
    });
    return { action: "stay", removedFromWorkspace: true };
  }

  return { action: "stay", removedFromWorkspace: false };
}
