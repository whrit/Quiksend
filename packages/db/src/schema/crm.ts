import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

export const crmProviderEnum = pgEnum("crm_provider", ["salesforce", "hubspot"]);

export const crmConnection = pgTable(
  "crm_connection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: crmProviderEnum("provider").notNull(),
    nangoConnectionId: text("nango_connection_id").notNull(),
    status: text("status").default("active").notNull(),
    fieldMapping: jsonb("field_mapping").notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("crm_connection_org_provider_uidx").on(table.organizationId, table.provider),
    uniqueIndex("crm_connection_nango_connection_id_uidx").on(table.nangoConnectionId),
  ],
);

export const syncState = pgTable(
  "sync_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => crmConnection.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    cursor: jsonb("cursor"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    status: text("status").default("idle").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("sync_state_connection_model_uidx").on(table.connectionId, table.model)],
);
