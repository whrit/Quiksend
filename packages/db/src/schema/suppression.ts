import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { message } from "./mail.ts";

export const suppressionReasonEnum = pgEnum("suppression_reason", [
  "bounce",
  "unsubscribe",
  "manual",
  "complaint",
]);

export const suppressionValueTypeEnum = pgEnum("suppression_value_type", ["email", "domain"]);

export const suppression = pgTable(
  "suppression",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    valueType: suppressionValueTypeEnum("value_type").default("email").notNull(),
    reason: suppressionReasonEnum("reason").notNull(),
    sourceMessageId: uuid("source_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("suppression_org_value_uidx").on(table.organizationId, table.value),
    index("suppression_org_reason_idx").on(table.organizationId, table.reason),
  ],
);
