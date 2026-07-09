/**
 * Unit test for the session-create hook helper. Uses the real DB (matches the
 * pattern in every other tenancy test in the repo). Verifies the three
 * branches:
 *   1. User with no memberships → returns null (onboarding path)
 *   2. User with one membership → returns that org id (fresh login)
 *   3. User whose prior session had an active org → reuses it (workspace
 *      switching sticks across logouts)
 */
import { randomUUID } from "node:crypto";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDefaultActiveOrganizationId } from "./auth.ts";

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function createUser(): Promise<string> {
  const id = makeId("user");
  await db.insert(tables.user).values({
    id,
    email: `${id}@test.local`,
    emailVerified: true,
    name: id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function createOrgWithMember(userId: string, order = 0): Promise<string> {
  const orgId = makeId("org");
  await db.insert(tables.organization).values({
    id: orgId,
    name: `Org ${orgId}`,
    slug: orgId,
    createdAt: new Date(Date.now() + order * 1000),
  });
  await db.insert(tables.member).values({
    id: makeId("mem"),
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: new Date(Date.now() + order * 1000),
  });
  return orgId;
}

async function createSession(userId: string, activeOrganizationId: string | null): Promise<void> {
  await db.insert(tables.session).values({
    id: makeId("sess"),
    token: makeId("tok"),
    userId,
    activeOrganizationId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

const createdUserIds: string[] = [];

async function trackUser(): Promise<string> {
  const id = await createUser();
  createdUserIds.push(id);
  return id;
}

afterEach(async () => {
  // Clean up in dependency order — session, member, org, user
  for (const userId of createdUserIds) {
    await db.delete(tables.session).where(eq(tables.session.userId, userId));
    const memberRows = await db.query.member.findMany({
      where: eq(tables.member.userId, userId),
      columns: { organizationId: true },
    });
    await db.delete(tables.member).where(eq(tables.member.userId, userId));
    for (const m of memberRows) {
      await db.delete(tables.organization).where(eq(tables.organization.id, m.organizationId));
    }
    await db.delete(tables.user).where(eq(tables.user.id, userId));
  }
  createdUserIds.length = 0;
});

describe("resolveDefaultActiveOrganizationId", () => {
  it("returns null for a user with no memberships (onboarding path)", async () => {
    const userId = await trackUser();
    expect(await resolveDefaultActiveOrganizationId(userId)).toBeNull();
  });

  it("returns the user's only workspace on a fresh login", async () => {
    const userId = await trackUser();
    const orgId = await createOrgWithMember(userId);
    expect(await resolveDefaultActiveOrganizationId(userId)).toBe(orgId);
  });

  it("reuses the prior session's active org when the user still belongs to it", async () => {
    const userId = await trackUser();
    const orgA = await createOrgWithMember(userId, 0);
    // Second membership exists but the prior-session preference must win, so
    // its id is captured for clarity but not asserted on here.
    await createOrgWithMember(userId, 1);
    // Prior session had orgA active — that should win, even though orgB is the
    // most-recently-joined membership (fallback path).
    await createSession(userId, orgA);
    expect(await resolveDefaultActiveOrganizationId(userId)).toBe(orgA);
  });

  it("ignores a prior session's active org if the user was removed from that workspace", async () => {
    const userId = await trackUser();
    const orgA = await createOrgWithMember(userId, 0);
    const orgB = await createOrgWithMember(userId, 1);
    await createSession(userId, orgA);
    // Simulate the user being kicked out of orgA
    await db
      .delete(tables.member)
      .where(and(eq(tables.member.userId, userId), eq(tables.member.organizationId, orgA)));
    expect(await resolveDefaultActiveOrganizationId(userId)).toBe(orgB);
  });
});
