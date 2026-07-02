/**
 * Prospect/company table definitions for CRM upsert.
 *
 * Track 2 owns the canonical schema in `packages/db/src/schema/prospects.ts`.
 * This worktree bootstraps the same shape locally so Phase 3 upsert can run
 * before Track 2 merges; keep in sync with WAVE_CONTEXT.md column list.
 */
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const prospectStatusEnum = pgEnum("prospect_status", [
  "new",
  "active",
  "replied",
  "bounced",
  "unsubscribed",
  "do_not_contact",
]);

export const prospectSourceEnum = pgEnum("prospect_source", ["manual", "csv", "crm", "api"]);

export const company = pgTable(
  "company",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name"),
    domain: text("domain"),
    industry: text("industry"),
    size: integer("size"),
    website: text("website"),
    linkedinUrl: text("linkedin_url"),
    customFields: jsonb("custom_fields"),
    crmProvider: text("crm_provider"),
    crmExternalId: text("crm_external_id"),
    crmConnectionId: uuid("crm_connection_id"),
    lastCrmSyncAt: timestamp("last_crm_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("company_org_domain_uidx").on(table.organizationId, table.domain),
    uniqueIndex("company_org_crm_external_uidx").on(
      table.organizationId,
      table.crmProvider,
      table.crmExternalId,
    ),
  ],
);

export const prospect = pgTable(
  "prospect",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    companyId: uuid("company_id"),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    title: text("title"),
    linkedinUrl: text("linkedin_url"),
    phone: text("phone"),
    timezone: text("timezone"),
    status: prospectStatusEnum("status").default("new").notNull(),
    source: prospectSourceEnum("source").default("manual").notNull(),
    customFields: jsonb("custom_fields"),
    crmProvider: text("crm_provider"),
    crmExternalId: text("crm_external_id"),
    crmConnectionId: uuid("crm_connection_id"),
    lastCrmSyncAt: timestamp("last_crm_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("prospect_org_email_uidx").on(table.organizationId, table.email),
    uniqueIndex("prospect_org_crm_external_uidx").on(
      table.organizationId,
      table.crmProvider,
      table.crmExternalId,
    ),
  ],
);
