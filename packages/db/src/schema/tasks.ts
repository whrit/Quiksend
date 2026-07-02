import { relations } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { mailbox } from "./mail.ts";
import { enrollment, sequenceStep } from "./sequences.ts";

export const taskTypeEnum = pgEnum("task_type", ["compose", "generic"]);

export const taskStatusEnum = pgEnum("task_status", ["open", "in_progress", "done", "skipped"]);

export const sendReservationStatusEnum = pgEnum("send_reservation_status", [
  "held",
  "sent",
  "released",
]);

export const jobLogStatusEnum = pgEnum("job_log_status", [
  "started",
  "succeeded",
  "failed",
  "dead",
]);

export const task = pgTable(
  "task",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollment.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => sequenceStep.id, { onDelete: "set null" }),
    type: taskTypeEnum("type").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: taskStatusEnum("status").default("open").notNull(),
    assignedUserId: text("assigned_user_id").references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("task_org_status_due_idx").on(table.organizationId, table.status, table.dueAt)],
);

export const sendReservation = pgTable(
  "send_reservation",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollment.id, { onDelete: "cascade" }),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).defaultNow().notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    status: sendReservationStatusEnum("status").default("held").notNull(),
  },
  (table) => [index("send_reservation_mailbox_reserved_idx").on(table.mailboxId, table.reservedAt)],
);

export const jobLog = pgTable(
  "job_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobName: text("job_name").notNull(),
    payloadRef: text("payload_ref"),
    status: jobLogStatusEnum("status").notNull(),
    attempt: integer("attempt").notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("job_log_payload_ref_created_idx").on(table.payloadRef, table.createdAt.desc()),
  ],
);

export const taskRelations = relations(task, ({ one }) => ({
  organization: one(organization, {
    fields: [task.organizationId],
    references: [organization.id],
  }),
  enrollment: one(enrollment, {
    fields: [task.enrollmentId],
    references: [enrollment.id],
  }),
  step: one(sequenceStep, {
    fields: [task.stepId],
    references: [sequenceStep.id],
  }),
  assignedUser: one(user, {
    fields: [task.assignedUserId],
    references: [user.id],
  }),
}));
