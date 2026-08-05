import { describe, expect, it } from "vitest";
import { asOrganizationId, asUserId, type OrgContext } from "@quiksend/core";
import { withTestOrgs } from "@quiksend/db/testing";
import { createApiKeyForOrg, listApiKeysForOrg, revokeApiKeyForOrg } from "./api-keys.functions.ts";
import { resolveApiKey } from "./api/v1/middleware.ts";

/**
 * `withTestOrgs` seeds each org with a single "owner" member — Better Auth's
 * default organization access-control statements only grant `apiKey`
 * actions to the creator role (`owner`), so every scenario below runs as one.
 */
function ownerContext(org: { id: string; userId: string }): OrgContext {
  return { userId: asUserId(org.userId), organizationId: asOrganizationId(org.id), role: "owner" };
}

function bearerRequest(key: string): Request {
  return new Request("http://localhost/api/v1/probe", {
    headers: { Authorization: `Bearer ${key}` },
  });
}

describe("api key tenancy", () => {
  it("creates a key through the production server-function path — organizationId is the referenceId, not metadata", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const created = await createApiKeyForOrg(ownerContext(orgA), { name: "Org A key" });

      expect(created.key).toBeTruthy();
      const ctx = await resolveApiKey(bearerRequest(created.key));
      expect(ctx).not.toBeNull();
      expect(ctx!.orgId).toBe(orgA.id);
    });
  });

  it("org B cannot list org A's API keys", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const created = await createApiKeyForOrg(ownerContext(orgA), { name: "Org A key" });

      const orgBKeys = await listApiKeysForOrg(ownerContext(orgB));
      expect(orgBKeys.find((key) => key.id === created.id)).toBeUndefined();

      const orgAKeys = await listApiKeysForOrg(ownerContext(orgA));
      expect(orgAKeys.find((key) => key.id === created.id)).toBeDefined();
    });
  });

  it("org B cannot revoke org A's API key", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const created = await createApiKeyForOrg(ownerContext(orgA), { name: "Protected key" });

      await expect(revokeApiKeyForOrg(ownerContext(orgB), created.id)).rejects.toThrow(/not found/i);

      const stillListed = await listApiKeysForOrg(ownerContext(orgA));
      expect(stillListed.find((key) => key.id === created.id)).toBeDefined();
    });
  });

  it("revoking a key makes it unauthorized against the public API", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const created = await createApiKeyForOrg(ownerContext(orgA), { name: "REST key" });

      const beforeRevoke = await resolveApiKey(bearerRequest(created.key));
      expect(beforeRevoke).not.toBeNull();
      expect(beforeRevoke!.orgId).toBe(orgA.id);

      await revokeApiKeyForOrg(ownerContext(orgA), created.id);

      const afterRevoke = await resolveApiKey(bearerRequest(created.key));
      expect(afterRevoke).toBeNull();
    });
  });

  it("two orgs can each create API keys with the same display name", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const keyA = await createApiKeyForOrg(ownerContext(orgA), { name: "Integration key" });
      const keyB = await createApiKeyForOrg(ownerContext(orgB), { name: "Integration key" });

      expect(keyA.id).toBeDefined();
      expect(keyB.id).toBeDefined();
      expect(keyA.id).not.toBe(keyB.id);
    });
  });
});
