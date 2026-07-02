import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

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
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name"),
    domain: text("domain"),
    industry: text("industry"),
    size: text("size"),
    website: text("website"),
    linkedinUrl: text("linkedin_url"),
    customFields: jsonb("custom_fields"),
    crmProvider: text("crm_provider"),
    crmExternalId: text("crm_external_id"),
    crmConnectionId: uuid("crm_connection_id"),
    lastCrmSyncAt: timestamp("last_crm_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("company_organization_id_idx").on(table.organizationId),
    index("company_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
    uniqueIndex("company_org_domain_uidx")
      .on(table.organizationId, table.domain)
      .where(sql`${table.domain} is not null`),
    uniqueIndex("company_org_crm_uidx")
      .on(table.organizationId, table.crmProvider, table.crmExternalId)
      .where(sql`${table.crmExternalId} is not null`),
  ],
);

export const prospect = pgTable(
  "prospect",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => company.id, { onDelete: "set null" }),
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("prospect_org_email_uidx").on(table.organizationId, table.email),
    index("prospect_org_status_idx").on(table.organizationId, table.status),
    index("prospect_org_company_idx").on(table.organizationId, table.companyId),
    index("prospect_org_created_idx")
      .on(table.organizationId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("prospect_email_trgm_idx").using("gin", table.email.op("gin_trgm_ops")),
    index("prospect_first_name_trgm_idx").using("gin", table.firstName.op("gin_trgm_ops")),
    index("prospect_last_name_trgm_idx").using("gin", table.lastName.op("gin_trgm_ops")),
    uniqueIndex("prospect_org_crm_uidx")
      .on(table.organizationId, table.crmProvider, table.crmExternalId)
      .where(sql`${table.crmExternalId} is not null`),
  ],
);

export const list = pgTable(
  "list",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("list_organization_id_idx").on(table.organizationId)],
);

export const listMember = pgTable(
  "list_member",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listId: uuid("list_id")
      .notNull()
      .references(() => list.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospect.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("list_member_list_prospect_uidx").on(table.listId, table.prospectId)],
);

export const importBatch = pgTable(
  "import_batch",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mapping: jsonb("mapping").notNull(),
    createdCount: integer("created_count").default(0).notNull(),
    updatedCount: integer("updated_count").default(0).notNull(),
    skippedCount: integer("skipped_count").default(0).notNull(),
    erroredCount: integer("errored_count").default(0).notNull(),
    status: text("status").default("processing").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("import_batch_organization_id_idx").on(table.organizationId)],
);

export const importError = pgTable(
  "import_error",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatch.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("import_error_batch_id_idx").on(table.batchId)],
);

export const companyRelations = relations(company, ({ one, many }) => ({
  organization: one(organization, {
    fields: [company.organizationId],
    references: [organization.id],
  }),
  prospects: many(prospect),
}));

export const prospectRelations = relations(prospect, ({ one, many }) => ({
  organization: one(organization, {
    fields: [prospect.organizationId],
    references: [organization.id],
  }),
  company: one(company, {
    fields: [prospect.companyId],
    references: [company.id],
  }),
  listMembers: many(listMember),
}));

export const listRelations = relations(list, ({ one, many }) => ({
  organization: one(organization, {
    fields: [list.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [list.createdByUserId],
    references: [user.id],
  }),
  members: many(listMember),
}));

export const listMemberRelations = relations(listMember, ({ one }) => ({
  list: one(list, {
    fields: [listMember.listId],
    references: [list.id],
  }),
  prospect: one(prospect, {
    fields: [listMember.prospectId],
    references: [prospect.id],
  }),
}));

export const importBatchRelations = relations(importBatch, ({ one, many }) => ({
  organization: one(organization, {
    fields: [importBatch.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [importBatch.createdByUserId],
    references: [user.id],
  }),
  errors: many(importError),
}));

export const importErrorRelations = relations(importError, ({ one }) => ({
  batch: one(importBatch, {
    fields: [importError.batchId],
    references: [importBatch.id],
  }),
}));
