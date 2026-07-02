import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
import { mailbox } from "./mail.ts";
import { prospect } from "./prospects.ts";

export const sequenceStatusEnum = pgEnum("sequence_status", ["draft", "active", "archived"]);

export const sequenceStepTypeEnum = pgEnum("sequence_step_type", [
  "manual_email",
  "auto_email",
  "wait",
  "task",
]);

export const defaultSequenceSettings = {
  timezone: "UTC",
  throttle_seconds: 90,
  mailbox_ids: [] as string[],
  stop_on_reply: true,
  business_days_only: true,
} as const;

export const sequence = pgTable(
  "sequence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: sequenceStatusEnum("status").default("draft").notNull(),
    settings: jsonb("settings").default(defaultSequenceSettings).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("sequence_organization_id_idx").on(table.organizationId)],
);

export const sequenceStep = pgTable(
  "sequence_step",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequence.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    stepType: sequenceStepTypeEnum("step_type").notNull(),
    delayMinutes: integer("delay_minutes").default(0).notNull(),
    businessDaysOnly: boolean("business_days_only").default(true).notNull(),
    config: jsonb("config").notNull(),
    variantB: jsonb("variant_b"),
    entryCondition: jsonb("entry_condition"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("sequence_step_sequence_index_uidx").on(table.sequenceId, table.stepIndex),
    index("sequence_step_org_sequence_idx").on(table.organizationId, table.sequenceId),
  ],
);

export const enrollment = pgTable(
  "enrollment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequence.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospect.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    state: text("state").default("active").notNull(),
    currentStepIndex: integer("current_step_index").default(0).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    anchorMessageId: text("anchor_message_id"),
    anchorThreadId: text("anchor_thread_id"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key"),
    abBucket: text("ab_bucket"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("enrollment_org_sequence_prospect_uidx").on(
      table.organizationId,
      table.sequenceId,
      table.prospectId,
    ),
    index("enrollment_state_next_run_idx").on(table.state, table.nextRunAt),
    index("enrollment_active_next_run_idx")
      .on(table.state, table.nextRunAt)
      .where(sql`${table.state} = 'active' AND ${table.nextRunAt} IS NOT NULL`),
    index("enrollment_org_sequence_idx").on(table.organizationId, table.sequenceId),
    index("enrollment_org_state_idx").on(table.organizationId, table.state),
    index("enrollment_org_prospect_idx").on(table.organizationId, table.prospectId),
  ],
);

export const sequenceRelations = relations(sequence, ({ one, many }) => ({
  organization: one(organization, {
    fields: [sequence.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [sequence.createdByUserId],
    references: [user.id],
  }),
  steps: many(sequenceStep),
  enrollments: many(enrollment),
}));

export const sequenceStepRelations = relations(sequenceStep, ({ one }) => ({
  sequence: one(sequence, {
    fields: [sequenceStep.sequenceId],
    references: [sequence.id],
  }),
  organization: one(organization, {
    fields: [sequenceStep.organizationId],
    references: [organization.id],
  }),
}));

export const enrollmentRelations = relations(enrollment, ({ one }) => ({
  organization: one(organization, {
    fields: [enrollment.organizationId],
    references: [organization.id],
  }),
  sequence: one(sequence, {
    fields: [enrollment.sequenceId],
    references: [sequence.id],
  }),
  prospect: one(prospect, {
    fields: [enrollment.prospectId],
    references: [prospect.id],
  }),
  mailbox: one(mailbox, {
    fields: [enrollment.mailboxId],
    references: [mailbox.id],
  }),
  createdBy: one(user, {
    fields: [enrollment.createdByUserId],
    references: [user.id],
  }),
}));
