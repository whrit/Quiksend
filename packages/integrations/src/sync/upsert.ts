import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { CrmProvider } from "../providers/types.ts";
import type { NormalizedAccount, NormalizedContact } from "./types.ts";
import { company, prospect } from "./tables.ts";

export interface UpsertContext {
  organizationId: string;
  connectionId: string;
  provider: CrmProvider;
}

type Db = PostgresJsDatabase<Record<string, never>>;

const crmWinsWhere = sql`(
  ${prospect.crmExternalId} IS NOT NULL
  AND (
    ${prospect.updatedAt} IS NULL
    OR ${prospect.lastCrmSyncAt} IS NULL
    OR ${prospect.updatedAt} <= ${prospect.lastCrmSyncAt} + interval '1 hour'
  )
)`;

const companyCrmWinsWhere = sql`(
  ${company.crmExternalId} IS NOT NULL
  AND (
    ${company.updatedAt} IS NULL
    OR ${company.lastCrmSyncAt} IS NULL
    OR ${company.updatedAt} <= ${company.lastCrmSyncAt} + interval '1 hour'
  )
)`;

function now(): Date {
  return new Date();
}

export async function upsertContacts(
  db: Db,
  ctx: UpsertContext,
  records: NormalizedContact[],
): Promise<void> {
  const syncAt = now();
  for (const record of records) {
    if (!record.externalId) continue;
    const email = record.email?.toLowerCase() ?? null;

    const byExternal = await db
      .select({ id: prospect.id })
      .from(prospect)
      .where(
        and(
          eq(prospect.organizationId, ctx.organizationId),
          eq(prospect.crmProvider, ctx.provider),
          eq(prospect.crmExternalId, record.externalId),
          isNull(prospect.deletedAt),
        ),
      )
      .limit(1);

    if (byExternal[0]) {
      await db
        .update(prospect)
        .set({
          email: email ?? undefined,
          firstName: record.firstName,
          lastName: record.lastName,
          title: record.title,
          linkedinUrl: record.linkedinUrl,
          phone: record.phone,
          crmConnectionId: ctx.connectionId,
          lastCrmSyncAt: syncAt,
          source: "crm",
          updatedAt: syncAt,
        })
        .where(and(eq(prospect.id, byExternal[0].id), crmWinsWhere));
      continue;
    }

    if (email) {
      const byEmail = await db
        .select({ id: prospect.id })
        .from(prospect)
        .where(
          and(
            eq(prospect.organizationId, ctx.organizationId),
            eq(prospect.email, email),
            isNull(prospect.deletedAt),
          ),
        )
        .limit(1);

      if (byEmail[0]) {
        await db
          .update(prospect)
          .set({
            crmProvider: ctx.provider,
            crmExternalId: record.externalId,
            crmConnectionId: ctx.connectionId,
            firstName: record.firstName,
            lastName: record.lastName,
            title: record.title,
            linkedinUrl: record.linkedinUrl,
            phone: record.phone,
            lastCrmSyncAt: syncAt,
            source: "crm",
            updatedAt: syncAt,
          })
          .where(eq(prospect.id, byEmail[0].id));
        continue;
      }
    }

    if (!email) continue;

    await db.insert(prospect).values({
      organizationId: ctx.organizationId,
      email,
      firstName: record.firstName,
      lastName: record.lastName,
      title: record.title,
      linkedinUrl: record.linkedinUrl,
      phone: record.phone,
      crmProvider: ctx.provider,
      crmExternalId: record.externalId,
      crmConnectionId: ctx.connectionId,
      lastCrmSyncAt: syncAt,
      source: "crm",
      createdAt: syncAt,
      updatedAt: syncAt,
    });
  }
}

export async function upsertAccounts(
  db: Db,
  ctx: UpsertContext,
  records: NormalizedAccount[],
): Promise<void> {
  const syncAt = now();
  for (const record of records) {
    if (!record.externalId) continue;
    const domain = record.domain?.toLowerCase() ?? null;

    const byExternal = await db
      .select({ id: company.id })
      .from(company)
      .where(
        and(
          eq(company.organizationId, ctx.organizationId),
          eq(company.crmProvider, ctx.provider),
          eq(company.crmExternalId, record.externalId),
          isNull(company.deletedAt),
        ),
      )
      .limit(1);

    if (byExternal[0]) {
      await db
        .update(company)
        .set({
          name: record.name,
          domain,
          industry: record.industry,
          size: record.size,
          website: record.website,
          crmConnectionId: ctx.connectionId,
          lastCrmSyncAt: syncAt,
          updatedAt: syncAt,
        })
        .where(and(eq(company.id, byExternal[0].id), companyCrmWinsWhere));
      continue;
    }

    if (domain) {
      const byDomain = await db
        .select({ id: company.id })
        .from(company)
        .where(
          and(
            eq(company.organizationId, ctx.organizationId),
            eq(company.domain, domain),
            isNull(company.deletedAt),
          ),
        )
        .limit(1);

      if (byDomain[0]) {
        await db
          .update(company)
          .set({
            crmProvider: ctx.provider,
            crmExternalId: record.externalId,
            crmConnectionId: ctx.connectionId,
            name: record.name,
            industry: record.industry,
            size: record.size,
            website: record.website,
            lastCrmSyncAt: syncAt,
            updatedAt: syncAt,
          })
          .where(eq(company.id, byDomain[0].id));
        continue;
      }
    }

    await db.insert(company).values({
      organizationId: ctx.organizationId,
      name: record.name,
      domain,
      industry: record.industry,
      size: record.size,
      website: record.website,
      crmProvider: ctx.provider,
      crmExternalId: record.externalId,
      crmConnectionId: ctx.connectionId,
      lastCrmSyncAt: syncAt,
      createdAt: syncAt,
      updatedAt: syncAt,
    });
  }
}

export async function linkContactsToCompanies(
  db: Db,
  ctx: UpsertContext,
  records: NormalizedContact[],
): Promise<void> {
  for (const record of records) {
    if (!record.externalId || !record.companyExternalId) continue;

    const companyRow = await db
      .select({ id: company.id })
      .from(company)
      .where(
        and(
          eq(company.organizationId, ctx.organizationId),
          eq(company.crmConnectionId, ctx.connectionId),
          eq(company.crmExternalId, record.companyExternalId),
          isNull(company.deletedAt),
        ),
      )
      .limit(1);

    if (!companyRow[0]) continue;

    await db
      .update(prospect)
      .set({ companyId: companyRow[0].id })
      .where(
        and(
          eq(prospect.organizationId, ctx.organizationId),
          eq(prospect.crmProvider, ctx.provider),
          eq(prospect.crmExternalId, record.externalId),
        ),
      );
  }
}
