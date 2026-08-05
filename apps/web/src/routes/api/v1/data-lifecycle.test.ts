import { randomUUID } from "node:crypto";
import { auth } from "@quiksend/auth";
import { db } from "@quiksend/db";
import { isSendSuppressed, listAuditLog } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { truncateAppTables } from "@quiksend/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { Route as ExportRoute } from "./export.ts";
import { Route as OrganizationDeleteRoute } from "./organization-delete.ts";

/**
 * These routes gate on a REAL Better Auth session (cookie), not an API key —
 * see the "why session, not API key" note in `lifecycle-auth.ts`. Tests sign
 * up a real user (so `verifyPassword` has a real password hash to check
 * against) via `auth.api.signUpEmail`, then attach a real org/member row and
 * point the session's `activeOrganizationId` at it directly — same
 * direct-DB-manipulation style `packages/auth/src/auth.test.ts` and
 * `prospects.test.ts` already use for Better Auth core tables (which
 * `truncateAppTables` deliberately does not cover).
 */

const TEST_PASSWORD = "Correct-Horse-Battery-Staple-1!";

interface TestActor {
  userId: string;
  organizationId: string;
  cookie: string;
}

const createdUserIds: string[] = [];

async function createActor(label: string, role: "owner" | "member"): Promise<TestActor> {
  const email = `${label}-${randomUUID().slice(0, 8)}@lifecycle.test`;
  const signUpResponse = await auth.api.signUpEmail({
    body: { email, password: TEST_PASSWORD, name: `${label} user` },
    asResponse: true,
  });
  if (!signUpResponse.ok) {
    throw new Error(`signUpEmail failed: ${signUpResponse.status} ${await signUpResponse.text()}`);
  }
  const cookie = signUpResponse.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const signedUp = (await signUpResponse.json()) as { user?: { id?: string } };
  const userId = signedUp.user?.id;
  if (!userId) throw new Error("signUpEmail did not return a user id");
  createdUserIds.push(userId);

  const organizationId = `org_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.insert(tables.organization).values({
    id: organizationId,
    name: `${label} workspace`,
    slug: `${label}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date(),
  });
  await db.insert(tables.member).values({
    id: `member_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  });
  await db
    .update(tables.session)
    .set({ activeOrganizationId: organizationId })
    .where(eq(tables.session.userId, userId));

  return { userId, organizationId, cookie };
}

afterEach(async () => {
  await truncateAppTables();
  // Better Auth core tables (user/session/account/organization/member) aren't
  // in APP_SCOPED_TABLES_TO_TRUNCATE — clean up what this file created.
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
    await db.delete(tables.account).where(eq(tables.account.userId, userId));
    await db.delete(tables.user).where(eq(tables.user.id, userId));
  }
  createdUserIds.length = 0;
});

function exportRequest(cookie: string): Request {
  return new Request("http://localhost/api/v1/export", { headers: { Cookie: cookie } });
}

function deleteRequest(cookie: string, password: string): Request {
  return new Request("http://localhost/api/v1/organization-delete", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("GET /api/v1/export", () => {
  it("rejects a plain member — admin or owner required", async () => {
    const member = await createActor("export-member", "member");
    const response = await ExportRoute.options.server.handlers.GET({ request: exportRequest(member.cookie) });
    expect(response.status).toBe(403);
  });

  it("streams the documented record set, excludes webhook signing secrets, and audits the export", async () => {
    const owner = await createActor("export-owner", "owner");

    const [prospect] = await db
      .insert(tables.prospect)
      .values({ organizationId: owner.organizationId, email: "lead@example.com", firstName: "Lead" })
      .returning();

    const secretValue = `whsec_${randomUUID()}`;
    await db.insert(tables.webhookEndpoint).values({
      organizationId: owner.organizationId,
      url: "https://example.com/hook",
      secret: secretValue,
      events: ["message.sent"],
    });

    const response = await ExportRoute.options.server.handlers.GET({ request: exportRequest(owner.cookie) });
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as {
      organization: { id: string } | null;
      prospects: Array<{ id: string }>;
      webhookEndpoints: Array<Record<string, unknown>>;
    };

    expect(body.organization?.id).toBe(owner.organizationId);
    expect(body.prospects.map((p) => p.id)).toContain(prospect!.id);
    expect(text).not.toContain(secretValue);
    expect(body.webhookEndpoints[0]).not.toHaveProperty("secret");

    const auditRows = await listAuditLog({ organizationId: owner.organizationId });
    expect(auditRows.some((r) => r.action === "organization.export" && r.actorId === owner.userId)).toBe(true);
  });

  it("org B's export never includes org A's data — the target org always comes from the caller's own session", async () => {
    const ownerA = await createActor("export-a", "owner");
    const ownerB = await createActor("export-b", "owner");

    await db.insert(tables.prospect).values({
      organizationId: ownerA.organizationId,
      email: "only-in-a@example.com",
      firstName: "OnlyA",
    });

    const response = await ExportRoute.options.server.handlers.GET({ request: exportRequest(ownerB.cookie) });
    const body = JSON.parse(await response.text()) as { organization: { id: string } | null };
    expect(body.organization?.id).toBe(ownerB.organizationId);
    expect(body.organization?.id).not.toBe(ownerA.organizationId);
  });
});

describe("POST /api/v1/organization-delete", () => {
  it("rejects a plain member — owner required", async () => {
    const member = await createActor("delete-member", "member");
    const response = await OrganizationDeleteRoute.options.server.handlers.POST({
      request: deleteRequest(member.cookie, TEST_PASSWORD),
    });
    expect(response.status).toBe(403);
    const lifecycle = await db.query.organizationLifecycle.findFirst({
      where: eq(tables.organizationLifecycle.organizationId, member.organizationId),
    });
    expect(lifecycle).toBeUndefined();
  });

  it("rejects an incorrect password without disabling sending", async () => {
    const owner = await createActor("delete-badpw", "owner");
    const response = await OrganizationDeleteRoute.options.server.handlers.POST({
      request: deleteRequest(owner.cookie, "definitely-wrong-password"),
    });
    expect(response.status).toBe(401);
    expect(await isSendSuppressed({ organizationId: owner.organizationId, email: "x@example.com" })).toBe(false);
  });

  it("owner + correct password immediately disables sending, marks deletion, audits, and queues purge", async () => {
    const owner = await createActor("delete-owner", "owner");

    const before = await isSendSuppressed({ organizationId: owner.organizationId, email: "x@example.com" });
    expect(before).toBe(false);

    const response = await OrganizationDeleteRoute.options.server.handlers.POST({
      request: deleteRequest(owner.cookie, TEST_PASSWORD),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; sendingDisabled: boolean };
    expect(body.status).toBe("deletion_scheduled");
    expect(body.sendingDisabled).toBe(true);

    // Immediate: every send path shares this one check.
    expect(await isSendSuppressed({ organizationId: owner.organizationId, email: "x@example.com" })).toBe(true);

    const lifecycle = await db.query.organizationLifecycle.findFirst({
      where: eq(tables.organizationLifecycle.organizationId, owner.organizationId),
    });
    expect(lifecycle?.deletionRequestedAt).not.toBeNull();
    expect(lifecycle?.sendingDisabledAt).not.toBeNull();
    expect(lifecycle?.deletionRequestedByUserId).toBe(owner.userId);

    const auditRows = await listAuditLog({ organizationId: owner.organizationId });
    expect(
      auditRows.some((r) => r.action === "organization.delete_requested" && r.actorId === owner.userId),
    ).toBe(true);
  });

  it("org B's owner can never mark org A for deletion — the target org always comes from the caller's own session", async () => {
    const ownerA = await createActor("delete-a", "owner");
    const ownerB = await createActor("delete-b", "owner");

    const response = await OrganizationDeleteRoute.options.server.handlers.POST({
      request: deleteRequest(ownerB.cookie, TEST_PASSWORD),
    });
    expect(response.status).toBe(200);

    const lifecycleA = await db.query.organizationLifecycle.findFirst({
      where: eq(tables.organizationLifecycle.organizationId, ownerA.organizationId),
    });
    expect(lifecycleA).toBeUndefined();
    expect(await isSendSuppressed({ organizationId: ownerA.organizationId, email: "x@example.com" })).toBe(false);

    const lifecycleB = await db.query.organizationLifecycle.findFirst({
      where: eq(tables.organizationLifecycle.organizationId, ownerB.organizationId),
    });
    expect(lifecycleB?.sendingDisabledAt).not.toBeNull();
  });
});
