import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { GatewayEvidence } from "@quiksend/mail/gateway-detect";
import { organization } from "./auth.ts";
import { mailbox } from "./mail.ts";
import { enrollment, sequence } from "./sequences.ts";
import {
  canaryArrivalStatusEnum,
  gatewayClassificationConfidenceEnum,
  gatewayTypeEnum,
  seedInboxPoolTagEnum,
} from "./deliverability-enums.ts";

// ============================================================
// Phase 11A — Gateway detection (from TAU)
// ============================================================

export const gatewayClassification = pgTable(
  "gateway_classification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailDomain: text("email_domain").notNull().unique(),
    gateway: gatewayTypeEnum("gateway").notNull(),
    mxRecords: jsonb("mx_records").$type<string[]>().notNull(),
    evidence: jsonb("evidence").$type<GatewayEvidence[]>().notNull(),
    confidence: gatewayClassificationConfidenceEnum("confidence").notNull(),
    classifiedAt: timestamp("classified_at", { withTimezone: true }).defaultNow().notNull(),
    ttlUntil: timestamp("ttl_until", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("gateway_classification_gateway_idx").on(t.gateway),
    index("gateway_classification_ttl_idx").on(t.ttlUntil),
  ],
);

export const gatewayClassificationRelations = relations(gatewayClassification, () => ({}));

// ============================================================
// Phase 11C — Canary deliverability (from PHI)
// ============================================================

export const seedInbox = pgTable(
  "seed_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    gateway: gatewayTypeEnum("gateway").notNull(),
    provider: text("provider").notNull(),
    imapConfig: text("imap_config").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    active: boolean("active").default(true).notNull(),
    notes: text("notes"),
    poolTag: seedInboxPoolTagEnum("pool_tag"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("seed_inbox_org_idx").on(table.organizationId),
    index("seed_inbox_org_active_idx").on(table.organizationId, table.active),
    index("seed_inbox_gateway_active_idx").on(table.gateway, table.active),
    index("seed_inbox_provider_gateway_active_idx")
      .on(table.gateway, table.active)
      .where(sql`${table.organizationId} IS NULL`),
    uniqueIndex("seed_inbox_email_uidx").on(table.email),
  ],
);

export const canarySend = pgTable(
  "canary_send",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequence.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id").references(() => enrollment.id, {
      onDelete: "set null",
    }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    seedInboxId: uuid("seed_inbox_id")
      .notNull()
      .references(() => seedInbox.id, { onDelete: "cascade" }),
    canaryToken: uuid("canary_token").notNull(),
    stepIndex: integer("step_index"),
    subject: text("subject").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    expectedArrivalAt: timestamp("expected_arrival_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    arrivalGatewayHeaders: jsonb("arrival_gateway_headers"),
    arrivalFolder: text("arrival_folder"),
    arrivalStatus: canaryArrivalStatusEnum("arrival_status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("canary_send_token_uidx").on(table.canaryToken),
    index("canary_send_org_sequence_idx").on(table.organizationId, table.sequenceId),
    index("canary_send_pending_idx")
      .on(table.arrivalStatus, table.expectedArrivalAt)
      .where(sql`${table.arrivalStatus} = 'pending'`),
    index("canary_send_seed_inbox_idx").on(table.seedInboxId),
    index("canary_send_pending_sent_at_idx")
      .on(table.sentAt)
      .where(sql`${table.arrivalStatus} = 'pending' AND ${table.sentAt} IS NOT NULL`),
    index("canary_send_sequence_mailbox_idx").on(table.sequenceId, table.mailboxId),
  ],
);

export const deliverabilitySnapshot = pgTable(
  "deliverability_snapshot",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    gateway: gatewayTypeEnum("gateway").notNull(),
    windowDays: integer("window_days").default(7).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    canaryTotal: integer("canary_total").default(0).notNull(),
    canaryDelivered: integer("canary_delivered").default(0).notNull(),
    canarySpam: integer("canary_spam").default(0).notNull(),
    canaryQuarantine: integer("canary_quarantine").default(0).notNull(),
    canarySilentDropped: integer("canary_silent_dropped").default(0).notNull(),
    deliverabilityPct: numeric("deliverability_pct", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("deliverability_snapshot_tuple_uidx").on(
      table.organizationId,
      table.mailboxId,
      table.gateway,
      table.windowDays,
      table.windowStart,
    ),
    index("deliverability_snapshot_org_window_idx").on(table.organizationId, table.windowStart),
  ],
);

export const seedInboxRelations = relations(seedInbox, ({ one, many }) => ({
  organization: one(organization, {
    fields: [seedInbox.organizationId],
    references: [organization.id],
  }),
  canarySends: many(canarySend),
}));

export const canarySendRelations = relations(canarySend, ({ one }) => ({
  organization: one(organization, {
    fields: [canarySend.organizationId],
    references: [organization.id],
  }),
  sequence: one(sequence, {
    fields: [canarySend.sequenceId],
    references: [sequence.id],
  }),
  enrollment: one(enrollment, {
    fields: [canarySend.enrollmentId],
    references: [enrollment.id],
  }),
  mailbox: one(mailbox, {
    fields: [canarySend.mailboxId],
    references: [mailbox.id],
  }),
  seedInbox: one(seedInbox, {
    fields: [canarySend.seedInboxId],
    references: [seedInbox.id],
  }),
}));

export const deliverabilitySnapshotRelations = relations(deliverabilitySnapshot, ({ one }) => ({
  organization: one(organization, {
    fields: [deliverabilitySnapshot.organizationId],
    references: [organization.id],
  }),
  mailbox: one(mailbox, {
    fields: [deliverabilitySnapshot.mailboxId],
    references: [mailbox.id],
  }),
}));
