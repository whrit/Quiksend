import { createHash } from "node:crypto";
import { logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { enqueue } from "@quiksend/queue";
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@quiksend/db/schema";
import type { EnrollmentContext } from "./context.ts";

type DbTx = PostgresJsDatabase<typeof schema>;

const TRACKED_ENGINE_EVENTS = new Set([
  "message.sent",
  "enrollment.completed",
  "enrollment.replied",
  "enrollment.bounced",
]);

const DELIVERABILITY_EVENTS = new Set([
  "deliverability.delivered_at_risk",
  "deliverability.mailbox_auto_swapped",
  "deliverability.anchor_threading_preserved",
  "enrollment.no_safe_mailbox_for_gateway",
  "mailbox.enterprise_safe_toggled",
  "workspace.deliverability_policy_changed",
]);

function normalizeAnalyticsType(engineType: string): string {
  if (engineType === "enrollment.replied") return "reply.received";
  if (engineType === "enrollment.bounced") return "bounce.received";
  return engineType;
}

function writebackJobEventType(engineType: string): "send" | "reply" | "status" | null {
  if (engineType === "message.sent") return "send";
  if (
    engineType === "enrollment.replied" ||
    engineType === "enrollment.bounced" ||
    engineType === "enrollment.completed"
  ) {
    return "status";
  }
  return null;
}

export function makeWritebackIdempotencyKey(
  organizationId: string,
  engineType: string,
  entityType: string,
  entityId: string,
): string {
  const raw = `${organizationId}:${engineType}:${entityType}:${entityId}`;
  return createHash("sha256").update(raw).digest("hex");
}

async function resolveEntityId(
  tx: DbTx,
  organizationId: string,
  engineType: string,
  ctx: EnrollmentContext,
): Promise<{ entityType: "message" | "enrollment"; entityId: string }> {
  if (engineType === "message.sent") {
    const latest = await tx.query.message.findFirst({
      where: and(
        eq(tables.message.enrollmentId, ctx.enrollmentId),
        eq(tables.message.organizationId, organizationId),
        eq(tables.message.direction, "outbound"),
      ),
      orderBy: [desc(tables.message.sentAt)],
    });
    if (latest) return { entityType: "message", entityId: latest.id };
  }
  return { entityType: "enrollment", entityId: ctx.enrollmentId };
}

async function findActiveCrmConnection(organizationId: string) {
  return db.query.crmConnection.findFirst({
    where: and(
      eq(tables.crmConnection.organizationId, organizationId),
      eq(tables.crmConnection.status, "active"),
    ),
  });
}

async function insertWritebackLog(
  dbOrTx: DbTx,
  organizationId: string,
  connectionId: string,
  engineType: string,
  entityType: string,
  entityId: string,
  jobEventType: "send" | "reply" | "status",
): Promise<string | null> {
  const idempotencyKey = makeWritebackIdempotencyKey(
    organizationId,
    engineType,
    entityType,
    entityId,
  );

  const writebackEventType =
    jobEventType === "status" ? ("status_update" as const) : ("activity_log" as const);

  await dbOrTx
    .insert(tables.crmWritebackLog)
    .values({
      organizationId,
      crmConnectionId: connectionId,
      eventType: writebackEventType,
      entityType,
      entityId,
      idempotencyKey,
      status: "pending",
      payload: { engineType, jobEventType },
    })
    .onConflictDoNothing({ target: tables.crmWritebackLog.idempotencyKey });

  return idempotencyKey;
}

async function scheduleWriteback(
  dbOrTx: DbTx,
  organizationId: string,
  engineType: string,
  entityType: string,
  entityId: string,
  jobEventType: "send" | "reply" | "status",
): Promise<void> {
  const connection = await findActiveCrmConnection(organizationId);
  if (!connection) return;

  const idempotencyKey = await insertWritebackLog(
    dbOrTx,
    organizationId,
    connection.id,
    engineType,
    entityType,
    entityId,
    jobEventType,
  );
  if (!idempotencyKey) return;

  await enqueue("crm.writeback", {
    connectionId: connection.id,
    eventType: jobEventType,
    entityId,
    idempotencyKey,
  });
}

/**
 * Handles `emit_event` effects from the sequence engine: persists analytics
 * events and enqueues CRM write-back jobs when a connection exists.
 */
export async function handleEmitEvent(
  tx: DbTx,
  ctx: EnrollmentContext,
  engineType: string,
): Promise<void> {
  logger.info(
    {
      organizationId: ctx.organizationId,
      enrollmentId: ctx.enrollmentId,
      event: engineType,
    },
    "enrollment event",
  );

  if (!TRACKED_ENGINE_EVENTS.has(engineType) && !DELIVERABILITY_EVENTS.has(engineType)) return;

  const { entityType, entityId } = await resolveEntityId(tx, ctx.organizationId, engineType, ctx);
  const analyticsType = normalizeAnalyticsType(engineType);

  await tx.insert(tables.event).values({
    organizationId: ctx.organizationId,
    type: analyticsType,
    entityType,
    entityId,
    payload: {
      enrollmentId: ctx.enrollmentId,
      prospectId: ctx.prospect.id,
      sequenceId: ctx.sequence.id,
      engineType,
    },
  });

  const jobEventType = writebackJobEventType(engineType);
  if (!jobEventType) return;

  await scheduleWriteback(tx, ctx.organizationId, engineType, entityType, entityId, jobEventType);
}

export type InboundWritebackInput = {
  organizationId: string;
  type: "reply.received" | "bounce.received";
  entityType: "message" | "enrollment" | "prospect";
  entityId: string;
  payload?: Record<string, unknown>;
};

/** Phase 7 inbound hook — same fan-out as engine events. */
export async function handleInboundWritebackEvent(input: InboundWritebackInput): Promise<void> {
  const engineType = input.type === "bounce.received" ? "enrollment.bounced" : "reply.received";
  const jobEventType = input.type === "reply.received" ? ("reply" as const) : ("status" as const);

  await db.insert(tables.event).values({
    organizationId: input.organizationId,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload ?? {},
  });

  await scheduleWriteback(
    db as DbTx,
    input.organizationId,
    engineType,
    input.entityType,
    input.entityId,
    jobEventType,
  );
}
