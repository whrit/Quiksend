import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { client, db, tables } from "@quiksend/db";
import { truncateAppTables } from "@quiksend/db/testing";
import { organization, user } from "@quiksend/db/schema";
import { linkContactsToCompanies, upsertAccounts, upsertContacts } from "./upsert.ts";
import type { NormalizedAccount, NormalizedContact } from "./types.ts";
import { company, prospect } from "./tables.ts";
import { drizzle as drizzleRaw } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

const syncDb = drizzleRaw(client, { casing: "snake_case" });

const ORG_ID = "org-upsert-test";
const USER_ID = "user-upsert-test";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000001";

const ctx = {
  organizationId: ORG_ID,
  connectionId: CONNECTION_ID,
  provider: "hubspot" as const,
};

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

describe("crm upsert", () => {
  beforeAll(async () => {
    const migrationsFolder = join(import.meta.dirname, "../../../db/drizzle");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required for upsert integration tests");
    const migrationClient = postgres(url, { max: 1 });
    await migrate(drizzle(migrationClient), { migrationsFolder });
    await migrationClient.end();

    await db
      .insert(user)
      .values({
        id: USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .insert(organization)
      .values({
        id: ORG_ID,
        name: "Upsert Org",
        slug: "upsert-org",
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .insert(tables.crmConnection)
      .values({
        id: CONNECTION_ID,
        organizationId: ORG_ID,
        provider: "hubspot",
        nangoConnectionId: "nango-test-conn",
        status: "active",
        fieldMapping: {},
        createdByUserId: USER_ID,
      })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    await truncateAppTables();
    await db
      .insert(tables.crmConnection)
      .values({
        id: CONNECTION_ID,
        organizationId: ORG_ID,
        provider: "hubspot",
        nangoConnectionId: "nango-test-conn",
        status: "active",
        fieldMapping: {},
        createdByUserId: USER_ID,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await client.end();
  });

  it("inserts on first sync", async () => {
    await upsertContacts(syncDb, ctx, [contact()]);
    const rows = await syncDb.select().from(prospect);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("ada@example.com");
    expect(rows[0]?.crmExternalId).toBe("hs-contact-1");
  });

  it("updates on second sync when CRM wins", async () => {
    await upsertContacts(syncDb, ctx, [contact({ title: "Engineer" })]);
    await upsertContacts(syncDb, ctx, [contact({ title: "Principal Engineer" })]);
    const rows = await syncDb.select().from(prospect);
    expect(rows[0]?.title).toBe("Principal Engineer");
  });

  it("attaches CRM ids when matched by email", async () => {
    await syncDb.insert(prospect).values({
      organizationId: ORG_ID,
      email: "ada@example.com",
      firstName: "Ada",
      source: "csv",
    });
    await upsertContacts(syncDb, ctx, [contact()]);
    const rows = await syncDb.select().from(prospect);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.crmExternalId).toBe("hs-contact-1");
    expect(rows[0]?.crmConnectionId).toBe(CONNECTION_ID);
  });

  it("preserves local edits within the 1h precedence window", async () => {
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

  it("links contacts to companies by external id", async () => {
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
