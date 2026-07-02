import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth.ts";
import { crmConnection } from "./crm.ts";

export const writebackEventTypeEnum = pgEnum("writeback_event_type", [
  "activity_log",
  "contact_upsert",
  "status_update",
]);

export const writebackStatusEnum = pgEnum("writeback_status", ["pending", "succeeded", "failed"]);

export const crmWritebackLog = pgTable(
  "crm_writeback_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    crmConnectionId: uuid("crm_connection_id").references(() => crmConnection.id, {
      onDelete: "set null",
    }),
    eventType: writebackEventTypeEnum("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    crmExternalId: text("crm_external_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: writebackStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    payload: jsonb("payload"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("crm_writeback_log_idempotency_uidx").on(table.idempotencyKey),
    index("crm_writeback_log_org_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const event = pgTable(
  "event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("event_org_type_created_idx").on(
      table.organizationId,
      table.type,
      table.createdAt.desc(),
    ),
    // Prospect timeline: filter entity_type = 'prospect' and entity_id = prospectId.
    index("event_org_entity_created_idx").on(
      table.organizationId,
      table.entityId,
      table.createdAt.desc(),
    ),
  ],
);

/** Rollup view for sequence-level analytics (materialized table deferred if slow). */
export const sequenceStats = pgView("sequence_stats", {
  organizationId: text("organization_id"),
  sequenceId: uuid("sequence_id"),
  enrolledCount: integer("enrolled_count"),
  sentCount: integer("sent_count"),
  repliedCount: integer("replied_count"),
  bouncedCount: integer("bounced_count"),
  completedCount: integer("completed_count"),
  activeCount: integer("active_count"),
}).as(sql`
  SELECT
    e.organization_id,
    e.sequence_id,
    COUNT(*)::int AS enrolled_count,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM message m
      WHERE m.enrollment_id = e.id
        AND m.organization_id = e.organization_id
        AND m.direction = 'outbound'
        AND m.status = 'sent'
    ))::int AS sent_count,
    COUNT(*) FILTER (WHERE e.state = 'replied')::int AS replied_count,
    COUNT(*) FILTER (WHERE e.state = 'bounced')::int AS bounced_count,
    COUNT(*) FILTER (WHERE e.state = 'completed')::int AS completed_count,
    COUNT(*) FILTER (WHERE e.state IN ('active', 'waiting', 'waiting_manual', 'paused'))::int AS active_count
  FROM enrollment e
  GROUP BY e.organization_id, e.sequence_id
`);

export type CrmWritebackLogRow = typeof crmWritebackLog.$inferSelect;
export type EventRow = typeof event.$inferSelect;
export type SequenceStatsRow = typeof sequenceStats.$inferSelect;
