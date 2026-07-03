import { relations } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

export const SUPPORTED_WEBHOOK_EVENTS = [
  "message.sent",
  "enrollment.completed",
  "enrollment.replied",
  "enrollment.bounced",
  "enrollment.paused",
  "enrollment.resumed",
  "enrollment.stopped",
  "enrollment.failed",
  "prospect.unsubscribed",
  // Phase 11 — enterprise deliverability (see docs/deliverability.md)
  "enrollment.no_safe_mailbox_for_gateway",
  "deliverability.canary.arrived",
  "deliverability.canary.silent_drop",
  "gateway.detected",
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export const webhookEndpointStatusEnum = pgEnum("webhook_endpoint_status", [
  "active",
  "paused",
  "error",
]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "succeeded",
  "failed",
  "dead",
]);

export const apiKeyUsage = pgTable(
  "api_key_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    apiKeyId: text("api_key_id").notNull(),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code").notNull(),
    ipAddress: text("ip_address"),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("api_key_usage_key_timestamp_idx").on(table.apiKeyId, table.timestamp.desc()),
    index("api_key_usage_org_timestamp_idx").on(table.organizationId, table.timestamp.desc()),
  ],
);

export const webhookEndpoint = pgTable(
  "webhook_endpoint",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").array().notNull(),
    status: webhookEndpointStatusEnum("status").default("active").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("webhook_endpoint_org_status_idx").on(table.organizationId, table.status)],
);

export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookDeliveryStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("webhook_delivery_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    index("webhook_delivery_endpoint_created_idx").on(table.endpointId, table.createdAt.desc()),
  ],
);

// domainEvent + suppression + their enums live in schema/writeback.ts (phase 9) and schema/suppression.ts (phase 7)

export const webhookEndpointRelations = relations(webhookEndpoint, ({ one, many }) => ({
  organization: one(organization, {
    fields: [webhookEndpoint.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [webhookEndpoint.createdByUserId],
    references: [user.id],
  }),
  deliveries: many(webhookDelivery),
}));

export const webhookDeliveryRelations = relations(webhookDelivery, ({ one }) => ({
  organization: one(organization, {
    fields: [webhookDelivery.organizationId],
    references: [organization.id],
  }),
  endpoint: one(webhookEndpoint, {
    fields: [webhookDelivery.endpointId],
    references: [webhookEndpoint.id],
  }),
}));
