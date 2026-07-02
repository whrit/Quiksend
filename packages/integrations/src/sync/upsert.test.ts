import { randomUUID } from "node:crypto";
import { drizzle as drizzleRaw } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { client, db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { linkContactsToCompanies, upsertAccounts, upsertContacts } from "./upsert.ts";
import type { NormalizedAccount, NormalizedContact } from "./types.ts";
import { company, prospect } from "./tables.ts";

const syncDb = drizzleRaw(client, { casing: "snake_case" });

function contact(overrides: Partial<NormalizedContact> = {}): NormalizedContact {
  return {
    externalId: "hs-contact-1",
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    title: "Engineer",
    linkedinUrl: null,
    phone: null,
    companyExternalId: null,
    lastModifiedISO: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function account(overrides: Partial<NormalizedAccount> = {}): NormalizedAccount {
  return {
    externalId: "hs-company-1",
    name: "Analytical Engines",
    domain: "analytical.example",
    industry: "Software",
    size: 42,
    website: "https://analytical.example",
    lastModifiedISO: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedConnection(orgId: string, userId: string) {
  const connectionId = randomUUID();
  await db.insert(tables.crmConnection).values({
    id: connectionId,
    organizationId: orgId,
    provider: "hubspot",
    nangoConnectionId: `nango-${connectionId}`,
    status: "active",
    fieldMapping: {},
    createdByUserId: userId,
  });
  return connectionId;
}

describe("crm upsert", () => {
  it("inserts on first sync", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const connectionId = await seedConnection(orgA.id, orgA.userId);
      const ctx = {
        organizationId: orgA.id,
        connectionId,
        provider: "hubspot" as const,
      };

      await upsertContacts(syncDb, ctx, [contact()]);
      const rows = await syncDb.select().from(prospect);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe("ada@example.com");
      expect(rows[0]?.crmExternalId).toBe("hs-contact-1");
    });
  });

  it("updates on second sync when CRM wins", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const connectionId = await seedConnection(orgA.id, orgA.userId);
      const ctx = {
        organizationId: orgA.id,
        connectionId,
        provider: "hubspot" as const,
      };

      await upsertContacts(syncDb, ctx, [contact({ title: "Engineer" })]);
      await upsertContacts(syncDb, ctx, [contact({ title: "Principal Engineer" })]);
      const rows = await syncDb.select().from(prospect);
      expect(rows[0]?.title).toBe("Principal Engineer");
    });
  });

  it("attaches CRM ids when matched by email", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const connectionId = await seedConnection(orgA.id, orgA.userId);
      const ctx = {
        organizationId: orgA.id,
        connectionId,
        provider: "hubspot" as const,
      };

      await syncDb.insert(prospect).values({
        organizationId: orgA.id,
        email: "ada@example.com",
        firstName: "Ada",
        source: "csv",
      });
      await upsertContacts(syncDb, ctx, [contact()]);
      const rows = await syncDb.select().from(prospect);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.crmExternalId).toBe("hs-contact-1");
      expect(rows[0]?.crmConnectionId).toBe(connectionId);
    });
  });

  it("preserves local edits within the 1h precedence window", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const connectionId = await seedConnection(orgA.id, orgA.userId);
      const ctx = {
        organizationId: orgA.id,
        connectionId,
        provider: "hubspot" as const,
      };

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await upsertContacts(syncDb, ctx, [contact({ title: "CRM Title" })]);
      const [row] = await syncDb.select().from(prospect);
      await syncDb
        .update(prospect)
        .set({
          title: "Local Title",
          updatedAt: new Date(),
          lastCrmSyncAt: twoHoursAgo,
        })
        .where(eq(prospect.id, row!.id));

      await upsertContacts(syncDb, ctx, [contact({ title: "CRM Override" })]);
      const [after] = await syncDb.select().from(prospect);
      expect(after?.title).toBe("Local Title");
    });
  });

  it("links contacts to companies by external id", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const connectionId = await seedConnection(orgA.id, orgA.userId);
      const ctx = {
        organizationId: orgA.id,
        connectionId,
        provider: "hubspot" as const,
      };

      await upsertAccounts(syncDb, ctx, [account()]);
      await upsertContacts(syncDb, ctx, [contact({ companyExternalId: "hs-company-1" })]);
      await linkContactsToCompanies(syncDb, ctx, [contact({ companyExternalId: "hs-company-1" })]);
      const rows = await syncDb
        .select({ companyId: prospect.companyId, domain: company.domain })
        .from(prospect)
        .innerJoin(company, eq(prospect.companyId, company.id));
      expect(rows[0]?.domain).toBe("analytical.example");
    });
  });
});
