import { randomUUID } from "node:crypto";
import { auth } from "@quiksend/auth";
import { asOrganizationId, asUserId, type MemberRole, type OrgContext } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type * as QuiksendQueue from "@quiksend/queue";
import { applySetCookies } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createApiKeyForOrg, listApiKeysForOrg, revokeApiKeyForOrg } from "./api-keys.functions.ts";
import { resolveApiKey } from "./api/v1/middleware.ts";

// `signUpEmail`'s `sendOnSignUp` hook durably enqueues a verification email
// (see `packages/auth/src/auth.ts`); real `enqueueWithRetries` would hit
// pg-boss for no reason in a unit test, so it's mocked out like
// `packages/auth/src/auth.test.ts` does for the same flow.
const enqueueWithRetriesMock = vi.hoisted(() => vi.fn().mockResolvedValue("job_1"));
vi.mock("@quiksend/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof QuiksendQueue>();
  return { ...actual, enqueueWithRetries: enqueueWithRetriesMock };
});

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function headersFromSetCookie(setCookie: string | null): Promise<Headers> {
  const headers = new Headers();
  if (setCookie) applySetCookies(headers, [setCookie]);
  return headers;
}

/**
 * Signs a fresh Better Auth user up and in for real, bypassing only the
 * verification-link round trip (flips `emailVerified` directly, same as
 * `packages/auth/src/auth.test.ts:signUpAndAuthenticate`) — every test below
 * that exercises Better Auth's own `/api/auth/api-key/*` endpoints needs a
 * genuine, signed session cookie, not a hand-rolled one.
 */
async function signUpAndAuthenticate(password = "correct horse battery staple"): Promise<{
  userId: string;
  headers: Headers;
}> {
  const email = `${makeId("user")}@test.local`;
  const signedUp = await auth.api.signUpEmail({ body: { email, password, name: email } });
  await db.update(tables.user).set({ emailVerified: true }).where(eq(tables.user.id, signedUp.user.id));
  const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const headers = await headersFromSetCookie(signedIn.headers.get("set-cookie"));
  return { userId: signedUp.user.id, headers };
}

/** Adds a fresh, real, authenticated user to an existing org at the given role. */
async function addMemberToOrg(orgId: string, role: MemberRole): Promise<{ userId: string; headers: Headers }> {
  const { userId, headers } = await signUpAndAuthenticate();
  await db.insert(tables.member).values({ id: makeId("mem"), organizationId: orgId, userId, role, createdAt: new Date() });
  return { userId, headers };
}

/** Creates a fresh org with one real, authenticated member at the given role. */
async function createOrgWithRole(role: MemberRole): Promise<{
  orgId: string;
  userId: string;
  headers: Headers;
  orgContext: OrgContext;
}> {
  const orgId = makeId("org");
  await db.insert(tables.organization).values({ id: orgId, name: `Org ${orgId}`, slug: orgId, createdAt: new Date() });
  const { userId, headers } = await addMemberToOrg(orgId, role);
  return { orgId, userId, headers, orgContext: { userId: asUserId(userId), organizationId: asOrganizationId(orgId), role } };
}

function bearerRequest(key: string): Request {
  return new Request("http://localhost/api/v1/probe", {
    headers: { Authorization: `Bearer ${key}` },
  });
}

describe("api key tenancy", () => {
  it("creates a key through the production server-function path — organizationId is the referenceId, not metadata", async () => {
    const owner = await createOrgWithRole("owner");
    const created = await createApiKeyForOrg(owner.orgContext, { name: "Org A key" }, owner.headers);

    expect(created.key).toBeTruthy();
    const ctx = await resolveApiKey(bearerRequest(created.key));
    expect(ctx).not.toBeNull();
    expect(ctx!.orgId).toBe(owner.orgId);
    expect(ctx!.apiKeyId).toBe(created.id);
  });

  it("org B cannot list org A's API keys", async () => {
    const orgA = await createOrgWithRole("owner");
    const orgB = await createOrgWithRole("owner");
    const created = await createApiKeyForOrg(orgA.orgContext, { name: "Org A key" }, orgA.headers);

    const orgBKeys = await listApiKeysForOrg(orgB.orgContext, orgB.headers);
    expect(orgBKeys.find((key) => key.id === created.id)).toBeUndefined();

    const orgAKeys = await listApiKeysForOrg(orgA.orgContext, orgA.headers);
    expect(orgAKeys.find((key) => key.id === created.id)).toBeDefined();
  });

  it("org B cannot revoke org A's API key", async () => {
    const orgA = await createOrgWithRole("owner");
    const orgB = await createOrgWithRole("owner");
    const created = await createApiKeyForOrg(orgA.orgContext, { name: "Protected key" }, orgA.headers);

    await expect(revokeApiKeyForOrg(orgB.orgContext, created.id, orgB.headers)).rejects.toThrow(/not found/i);

    const stillListed = await listApiKeysForOrg(orgA.orgContext, orgA.headers);
    expect(stillListed.find((key) => key.id === created.id)).toBeDefined();
  });

  it("revoke never lists — a key beyond any list page boundary still revokes", async () => {
    const owner = await createOrgWithRole("owner");
    const created = await createApiKeyForOrg(owner.orgContext, { name: "Beyond page 1" }, owner.headers);

    // The old implementation pre-listed the org's keys capped at
    // `LIST_API_KEYS_LIMIT` (100) and searched the page client-side before
    // deleting — a 101st (or later) key would silently "not be found" and
    // the revoke would spuriously fail. Proving `listApiKeys` is never even
    // called is a stronger, deterministic stand-in for provisioning 100+
    // real keys to push this one past that boundary.
    const listSpy = vi.spyOn(auth.api, "listApiKeys");
    try {
      await revokeApiKeyForOrg(owner.orgContext, created.id, owner.headers);
      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      listSpy.mockRestore();
    }

    const afterRevoke = await resolveApiKey(bearerRequest(created.key));
    expect(afterRevoke).toBeNull();
  });

  it("revoking a key makes it unauthorized against the public API", async () => {
    const owner = await createOrgWithRole("owner");
    const created = await createApiKeyForOrg(owner.orgContext, { name: "REST key" }, owner.headers);

    const beforeRevoke = await resolveApiKey(bearerRequest(created.key));
    expect(beforeRevoke).not.toBeNull();
    expect(beforeRevoke!.orgId).toBe(owner.orgId);
    expect(beforeRevoke!.userId).toBeNull();

    await revokeApiKeyForOrg(owner.orgContext, created.id, owner.headers);

    const afterRevoke = await resolveApiKey(bearerRequest(created.key));
    expect(afterRevoke).toBeNull();
  });

  it("an ownerless org's API key remains valid — org-owned, not owner-owned", async () => {
    const owner = await createOrgWithRole("owner");
    const created = await createApiKeyForOrg(owner.orgContext, { name: "Org key" }, owner.headers);

    // The org now has zero members at all — the key's validity and org
    // scope must not depend on any particular human still existing.
    await db.delete(tables.member).where(eq(tables.member.organizationId, owner.orgId));

    const ctx = await resolveApiKey(bearerRequest(created.key));
    expect(ctx).not.toBeNull();
    expect(ctx!.orgId).toBe(owner.orgId);
    expect(ctx!.userId).toBeNull();
    expect(ctx!.apiKeyId).toBe(created.id);
  });

  it("two orgs can each create API keys with the same display name", async () => {
    const orgA = await createOrgWithRole("owner");
    const orgB = await createOrgWithRole("owner");
    const keyA = await createApiKeyForOrg(orgA.orgContext, { name: "Integration key" }, orgA.headers);
    const keyB = await createApiKeyForOrg(orgB.orgContext, { name: "Integration key" }, orgB.headers);

    expect(keyA.id).toBeDefined();
    expect(keyB.id).toBeDefined();
    expect(keyA.id).not.toBe(keyB.id);
  });

  it("admin can create, list, and revoke API keys through the app path", async () => {
    const admin = await createOrgWithRole("admin");
    const created = await createApiKeyForOrg(admin.orgContext, { name: "Admin key" }, admin.headers);
    expect(created.key).toBeTruthy();

    const keys = await listApiKeysForOrg(admin.orgContext, admin.headers);
    expect(keys.find((key) => key.id === created.id)).toBeDefined();

    await revokeApiKeyForOrg(admin.orgContext, created.id, admin.headers);
    const afterRevoke = await listApiKeysForOrg(admin.orgContext, admin.headers);
    expect(afterRevoke.find((key) => key.id === created.id)).toBeUndefined();
  });

  it("member is denied through the app path", async () => {
    const member = await createOrgWithRole("member");

    await expect(createApiKeyForOrg(member.orgContext, { name: "x" }, member.headers)).rejects.toThrow(
      /admin or owner/i,
    );
    await expect(listApiKeysForOrg(member.orgContext, member.headers)).rejects.toThrow(/admin or owner/i);
    await expect(revokeApiKeyForOrg(member.orgContext, "key_missing", member.headers)).rejects.toThrow(
      /admin or owner/i,
    );
  });

  it("member is denied through Better Auth's raw endpoint; owner and admin succeed", async () => {
    const owner = await createOrgWithRole("owner");
    const admin = await createOrgWithRole("admin");
    const member = await createOrgWithRole("member");

    await expect(
      auth.api.createApiKey({
        body: { name: "member raw key", organizationId: member.orgId },
        headers: member.headers,
      }),
    ).rejects.toThrow();

    const ownerCreated = await auth.api.createApiKey({
      body: { name: "owner raw key", organizationId: owner.orgId },
      headers: owner.headers,
    });
    expect(ownerCreated.key).toBeTruthy();

    const adminCreated = await auth.api.createApiKey({
      body: { name: "admin raw key", organizationId: admin.orgId },
      headers: admin.headers,
    });
    expect(adminCreated.key).toBeTruthy();

    // Explicit access-control statement applies uniformly: same owner/admin
    // grant, member denial for list and delete too, not just create.
    await expect(
      auth.api.listApiKeys({ query: { organizationId: member.orgId }, headers: member.headers }),
    ).rejects.toThrow();
    const ownerList = await auth.api.listApiKeys({
      query: { organizationId: owner.orgId },
      headers: owner.headers,
    });
    expect(ownerList.apiKeys.some((key) => key.id === ownerCreated.id)).toBe(true);

    // Same-org member (not just a different org entirely) is denied delete —
    // isolates the role-based grant from cross-org isolation, which the
    // list-scoping tests above already cover.
    const memberInAdminOrg = await addMemberToOrg(admin.orgId, "member");
    await expect(
      auth.api.deleteApiKey({ body: { keyId: adminCreated.id }, headers: memberInAdminOrg.headers }),
    ).rejects.toThrow();
    const deleted = await auth.api.deleteApiKey({ body: { keyId: adminCreated.id }, headers: admin.headers });
    expect(deleted.success).toBe(true);
  });
});
