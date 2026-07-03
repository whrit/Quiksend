import { z } from "zod";

/**
 * Central job registry.
 *
 * Each job exports:
 *   • a Zod schema (for runtime validation on both producer + consumer)
 *   • a NAMED payload interface (so consumers depend on the contract, not on the
 *     schema's inferred shape)
 *
 * Adding a job = new schema + interface + entry in the registry map + a handler
 * registration in `apps/worker`.
 */

// ── hello.ping — smoke test job ─────────────────────────────────────────────
export const helloPingSchema = z.object({ message: z.string() });
export interface HelloPingPayload {
  message: string;
}

// ── sequence.tick — periodic scheduler tick (Phase 6) ────────────────────────
export const sequenceTickSchema = z.object({});
export type SequenceTickPayload = Record<string, never>;

// ── sequence.step — execute a single enrollment step (Phase 6) ──────────────
export const sequenceStepSchema = z.object({
  enrollmentId: z.string().uuid(),
  attempt: z.number().int().nonnegative(),
});
export interface SequenceStepPayload {
  enrollmentId: string;
  attempt: number;
}

// ── mailbox.poll — inbound reply/bounce polling (Phase 7) ───────────────────
export const mailboxPollSchema = z.object({
  mailboxId: z.string().uuid(),
  since: z.string().datetime(),
});
export interface MailboxPollPayload {
  mailboxId: string;
  since: string;
}

// ── crm.sync — pull changed records from a connected CRM (Phase 3) ──────────
export const crmSyncFilterSchema = z.enum(["all", "modified_since", "tagged"]);

export const crmSyncSchema = z.object({
  connectionId: z.string().uuid(),
  model: z.enum(["Contact", "Account", "Company"]),
  targetListId: z.string().uuid().optional(),
  filter: crmSyncFilterSchema.optional(),
  modifiedSinceDays: z.number().int().positive().optional(),
  tag: z.string().max(200).optional(),
});
export interface CrmSyncPayload {
  connectionId: string;
  model: "Contact" | "Account" | "Company";
  targetListId?: string;
  filter?: "all" | "modified_since" | "tagged";
  modifiedSinceDays?: number;
  tag?: string;
}

// ── crm.writeback — log activity / update contact on CRM (Phase 9) ──────────
export const crmWritebackSchema = z.object({
  connectionId: z.string().uuid(),
  eventType: z.enum(["send", "reply", "status", "contact_upsert"]),
  entityId: z.string().uuid(),
  idempotencyKey: z.string(),
});
export interface CrmWritebackPayload {
  connectionId: string;
  eventType: "send" | "reply" | "status" | "contact_upsert";
  entityId: string;
  idempotencyKey: string;
}

// ── webhook.deliver — outbound HMAC-signed webhook attempt (Phase 10) ───────
export const webhookDeliverSchema = z.object({ deliveryId: z.string().uuid() });
export interface WebhookDeliverPayload {
  deliveryId: string;
}

// ── ai.research — research a prospect (Phase 8) ─────────────────────────────
export const aiResearchSchema = z.object({
  prospectId: z.string().uuid(),
  forceRefresh: z.boolean().default(false),
});
export interface AiResearchPayload {
  prospectId: string;
  forceRefresh: boolean;
}

// ── import.process — async CSV prospect import (Wave 5) ─────────────────────
const importProcessRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  prospect: z.object({
    email: z.string(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    linkedinUrl: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  }),
  company: z
    .object({
      name: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
    })
    .optional(),
});

export const importProcessSchema = z.object({
  batchId: z.string().uuid(),
  organizationId: z.string(),
  dedupePolicy: z.enum(["skip_existing", "update_existing"]),
  rows: z.array(importProcessRowSchema).max(5000),
});
export interface ImportProcessPayload {
  batchId: string;
  organizationId: string;
  dedupePolicy: "skip_existing" | "update_existing";
  rows: z.infer<typeof importProcessRowSchema>[];
}

// ── gateway.detect_* — email gateway classification (Phase 11A) ───────────
export const gatewayDetectSingleSchema = z.object({
  email: z.string().email(),
});
export interface GatewayDetectSinglePayload {
  email: string;
}

export const gatewayDetectBulkSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(5000),
});
export interface GatewayDetectBulkPayload {
  emails: string[];
}

export const gatewayApplyClassificationSchema = z.object({
  organizationId: z.string().optional(),
  domain: z.string().optional(),
});
export interface GatewayApplyClassificationPayload {
  organizationId?: string;
  domain?: string;
}

export const gatewaySweepStaleSchema = z.object({});
export type GatewaySweepStalePayload = Record<string, never>;

/**
 * Mapping from job name → concrete payload type. Consumers use this to look up
 * a payload interface by job name at the type level; runtime code uses
 * `JobSchemas[name]` for validation.
 */
// ── seed_inbox.verify — IMAP credential verification (Phase 11C) ───────────────
export const seedInboxVerifySchema = z.object({
  seedInboxId: z.string().uuid(),
});
export interface SeedInboxVerifyPayload {
  seedInboxId: string;
}

// ── canary.send — materialize a pending canary send (Phase 11C) ───────────────
export const canarySendJobSchema = z.object({
  canarySendId: z.string().uuid(),
});
export interface CanarySendJobPayload {
  canarySendId: string;
}

// ── canary.check — poll seed inboxes for canary arrival (Phase 11C) ───────────
export const canaryCheckSchema = z.object({});
export type CanaryCheckPayload = Record<string, never>;

// ── deliverability.snapshot — rollup grid aggregates (Phase 11C) ──────────────
export const deliverabilitySnapshotSchema = z.object({});
export type DeliverabilitySnapshotPayload = Record<string, never>;

export interface JobPayloadMap {
  "hello.ping": HelloPingPayload;
  "sequence.tick": SequenceTickPayload;
  "sequence.step": SequenceStepPayload;
  "mailbox.poll": MailboxPollPayload;
  "crm.sync": CrmSyncPayload;
  "crm.writeback": CrmWritebackPayload;
  "webhook.deliver": WebhookDeliverPayload;
  "ai.research": AiResearchPayload;
  "import.process": ImportProcessPayload;
  "gateway.detect_single": GatewayDetectSinglePayload;
  "gateway.detect_bulk": GatewayDetectBulkPayload;
  "gateway.apply_classification": GatewayApplyClassificationPayload;
  "gateway.sweep_stale": GatewaySweepStalePayload;
  "seed_inbox.verify": SeedInboxVerifyPayload;
  "canary.send": CanarySendJobPayload;
  "canary.check": CanaryCheckPayload;
  "deliverability.snapshot": DeliverabilitySnapshotPayload;
}

export type JobName = keyof JobPayloadMap;

export const JobSchemas: Readonly<Record<JobName, z.ZodTypeAny>> = {
  "hello.ping": helloPingSchema,
  "sequence.tick": sequenceTickSchema,
  "sequence.step": sequenceStepSchema,
  "mailbox.poll": mailboxPollSchema,
  "crm.sync": crmSyncSchema,
  "crm.writeback": crmWritebackSchema,
  "webhook.deliver": webhookDeliverSchema,
  "ai.research": aiResearchSchema,
  "import.process": importProcessSchema,
  "gateway.detect_single": gatewayDetectSingleSchema,
  "gateway.detect_bulk": gatewayDetectBulkSchema,
  "gateway.apply_classification": gatewayApplyClassificationSchema,
  "gateway.sweep_stale": gatewaySweepStaleSchema,
  "seed_inbox.verify": seedInboxVerifySchema,
  "canary.send": canarySendJobSchema,
  "canary.check": canaryCheckSchema,
  "deliverability.snapshot": deliverabilitySnapshotSchema,
};

export const JOB_NAMES: readonly JobName[] = Object.keys(JobSchemas) as JobName[];
/**
 * Mapping from job name → concrete payload type. Consumers use this to look up
 * a payload interface by job name at the type level; runtime code uses
 * `JobSchemas[name]` for validation.
 */
