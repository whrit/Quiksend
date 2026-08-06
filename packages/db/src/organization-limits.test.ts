import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./client.ts";
import {
  consumePeriodicQuota,
  getOrganizationLimits,
  isDeliverabilityProEntitled,
  releaseMailboxSlotInTx,
  reserveMailboxSlotInTx,
  stripProtectedMetadataKeys,
} from "./organization-limits.ts";
import * as tables from "./schema/index.ts";
import { truncateAppTables, withTestOrgs } from "./testing.ts";

describe("organization limits", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("gives every org the documented defaults when no row is provisioned", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const limits = await getOrganizationLimits(orgA.id);
      expect(limits).toEqual({
        deliverabilityPro: false,
        mailboxLimit: 5,
        apiRequestsPerDay: 10_000,
        aiResearchPerMonth: 1_000,
        dnsChecksPerDay: 5_000,
        importRowsPerJob: 5_000,
      });
    });
  });

  it("client-controlled organization.metadata cannot enable Deliverability Pro", async () => {
    await withTestOrgs(async ({ orgA }) => {
      // Simulates a workspace owner calling Better Auth's org-update endpoint
      // directly with a forged billing payload — the exact vector this table
      // replaces. Nothing may read this field for entitlement decisions.
      await db
        .update(tables.organization)
        .set({
          metadata: JSON.stringify({
            entitlements: { deliverability_pro: { activeUntil: "2099-12-31T00:00:00.000Z" } },
          }),
        })
        .where(eq(tables.organization.id, orgA.id));

      expect(await isDeliverabilityProEntitled(orgA.id)).toBe(false);
    });
  });

  it("is entitled only while the server-owned row's expiry is in the future", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.organizationLimit).values({
        organizationId: orgA.id,
        deliverabilityProUntil: new Date(Date.now() - 60_000),
      });
      expect(await isDeliverabilityProEntitled(orgA.id)).toBe(false);

      await db
        .update(tables.organizationLimit)
        .set({ deliverabilityProUntil: new Date(Date.now() + 60_000) })
        .where(eq(tables.organizationLimit.organizationId, orgA.id));
      expect(await isDeliverabilityProEntitled(orgA.id)).toBe(true);
    });
  });

  it("scopes limits and entitlement per organization", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db.insert(tables.organizationLimit).values({
        organizationId: orgA.id,
        deliverabilityProUntil: new Date(Date.now() + 60_000),
        mailboxLimit: 1,
      });

      expect(await isDeliverabilityProEntitled(orgA.id)).toBe(true);
      expect(await isDeliverabilityProEntitled(orgB.id)).toBe(false);
      expect((await getOrganizationLimits(orgB.id)).mailboxLimit).toBe(5);
    });
  });

  it("consumes quota atomically and refuses once the limit is met", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.organizationLimit).values({
        organizationId: orgA.id,
        apiRequestsPerDay: 2,
      });

      expect(await consumePeriodicQuota(orgA.id, "apiRequest")).toBe(true);
      expect(await consumePeriodicQuota(orgA.id, "apiRequest")).toBe(true);
      expect(await consumePeriodicQuota(orgA.id, "apiRequest")).toBe(false);
    });
  });

  it("refuses immediately when the org's limit is zero, even on the first call", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.organizationLimit).values({
        organizationId: orgA.id,
        dnsChecksPerDay: 0,
      });
      expect(await consumePeriodicQuota(orgA.id, "dnsCheck")).toBe(false);
    });
  });

  it("two concurrent consumes cannot together exceed a limit of one", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.organizationLimit).values({
        organizationId: orgA.id,
        aiResearchPerMonth: 1,
      });

      const [first, second] = await Promise.all([
        consumePeriodicQuota(orgA.id, "aiResearch"),
        consumePeriodicQuota(orgA.id, "aiResearch"),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });
  });

  it("reserves mailbox slots atomically against mailboxLimit and releases them on delete", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.organizationLimit).values({
        organizationId: orgA.id,
        mailboxLimit: 1,
      });

      const [first, second] = await Promise.all([
        db.transaction((tx) => reserveMailboxSlotInTx(tx, orgA.id)),
        db.transaction((tx) => reserveMailboxSlotInTx(tx, orgA.id)),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);

      // The freed slot becomes available again after release.
      await db.transaction((tx) => releaseMailboxSlotInTx(tx, orgA.id));
      expect(await db.transaction((tx) => reserveMailboxSlotInTx(tx, orgA.id))).toBe(true);
    });
  });

  it("rolls the mailbox reservation back if the transaction it ran in fails", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.organizationLimit).values({
        organizationId: orgA.id,
        mailboxLimit: 1,
      });

      await expect(
        db.transaction(async (tx) => {
          const ok = await reserveMailboxSlotInTx(tx, orgA.id);
          expect(ok).toBe(true);
          throw new Error("simulated downstream insert failure");
        }),
      ).rejects.toThrow("simulated downstream insert failure");

      // Reservation must have rolled back with the transaction — the slot is
      // still free, not permanently leaked.
      expect(await db.transaction((tx) => reserveMailboxSlotInTx(tx, orgA.id))).toBe(true);
    });
  });

  it("strips protected billing keys from a metadata write while keeping the rest", () => {
    const next = stripProtectedMetadataKeys({
      postal_address: "1 Main St",
      entitlements: { deliverability_pro: { activeUntil: "2099-01-01" } },
      billing: { plan: "enterprise" },
      canary_defaults: { enabled: true },
    });
    expect(next).toEqual({
      postal_address: "1 Main St",
      canary_defaults: { enabled: true },
    });
  });
});
