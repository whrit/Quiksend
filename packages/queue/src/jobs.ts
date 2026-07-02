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

/**
 * Mapping from job name → concrete payload type. Consumers use this to look up
 * a payload interface by job name at the type level; runtime code uses
 * `JobSchemas[name]` for validation.
 */
export interface JobPayloadMap {
  "hello.ping": HelloPingPayload;
  "sequence.tick": SequenceTickPayload;
  "sequence.step": SequenceStepPayload;
  "mailbox.poll": MailboxPollPayload;
  "crm.sync": CrmSyncPayload;
  "crm.writeback": CrmWritebackPayload;
  "webhook.deliver": WebhookDeliverPayload;
  "ai.research": AiResearchPayload;
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
};

export const JOB_NAMES: readonly JobName[] = Object.keys(JobSchemas) as JobName[];
