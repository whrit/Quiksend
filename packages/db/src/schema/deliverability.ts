import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { GatewayEvidence } from "@quiksend/mail/gateway-detect";
import { gatewayClassificationConfidenceEnum, gatewayTypeEnum } from "./deliverability-enums.ts";

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
