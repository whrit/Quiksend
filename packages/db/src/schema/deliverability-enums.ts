import { pgEnum } from "drizzle-orm/pg-core";

export const gatewayTypeEnum = pgEnum("gateway_type", [
  "proofpoint",
  "mimecast",
  "barracuda",
  "cisco_ironport",
  "trend_micro",
  "fortinet",
  "sophos",
  "symantec",
  "google_workspace",
  "microsoft_365",
  "zoho",
  "fastmail",
  "other",
  "unknown",
]);

export const canaryArrivalStatusEnum = pgEnum("canary_arrival_status", [
  "pending",
  "arrived_inbox",
  "arrived_spam",
  "arrived_quarantine",
  "silent_drop",
  "bounced",
]);

export const seedInboxPoolTagEnum = pgEnum("seed_inbox_pool_tag", [
  "production",
  "canary_only",
  "warmup",
]);

export const gatewayClassificationConfidenceEnum = pgEnum("gateway_classification_confidence", [
  "high",
  "medium",
  "low",
]);
