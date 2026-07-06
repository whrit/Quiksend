import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import {
  getNango,
  logHubspotEngagement,
  logSalesforceTask,
  updateHubspotStatus,
  updateSalesforceStatus,
  upsertHubspotContact,
  upsertSalesforceContact,
} from "@quiksend/integrations";
import { registerHandler } from "@quiksend/queue";
import { and, eq } from "drizzle-orm";

const DEFAULT_STATUS_FIELD: Record<string, string> = {
  salesforce: "Description",
  hubspot: "quiksend_status",
};

const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  replied: "Replied",
  bounced: "Bounced",
  completed: "Completed",
};

type WritebackContext = {
  organizationId: string;
  connectionId: string;
  nangoConnectionId: string;
  provider: "salesforce" | "hubspot";
};

async function loadWritebackContext(
  connectionId: string,
  expectedOrgId?: string,
): Promise<WritebackContext | null> {
  const connection = await db.query.crmConnection.findFirst({
    where: expectedOrgId
      ? and(
          eq(tables.crmConnection.id, connectionId),
          eq(tables.crmConnection.organizationId, expectedOrgId),
        )
      : eq(tables.crmConnection.id, connectionId),
  });
  if (!connection || connection.status !== "active") return null;
  return {
    organizationId: connection.organizationId,
    connectionId: connection.id,
    nangoConnectionId: connection.nangoConnectionId,
    provider: connection.provider,
  };
}

async function resolveProspectForEntity(
  organizationId: string,
  entityId: string,
  logRow: typeof tables.crmWritebackLog.$inferSelect,
) {
  if (logRow.entityType === "message") {
    const message = await db.query.message.findFirst({
      where: and(
        eq(tables.message.id, entityId),
        eq(tables.message.organizationId, organizationId),
      ),
    });
    if (!message?.prospectId) return null;
    return db.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.id, message.prospectId),
        eq(tables.prospect.organizationId, organizationId),
      ),
    });
  }

  if (logRow.entityType === "enrollment") {
    const enrollment = await db.query.enrollment.findFirst({
      where: and(
        eq(tables.enrollment.id, entityId),
        eq(tables.enrollment.organizationId, organizationId),
      ),
    });
    if (!enrollment) return null;
    return db.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.id, enrollment.prospectId),
        eq(tables.prospect.organizationId, organizationId),
      ),
    });
  }

  return db.query.prospect.findFirst({
    where: and(
      eq(tables.prospect.id, entityId),
      eq(tables.prospect.organizationId, organizationId),
    ),
  });
}

async function resolveEnrollmentState(
  organizationId: string,
  logRow: typeof tables.crmWritebackLog.$inferSelect,
) {
  if (logRow.entityType === "enrollment") {
    return db.query.enrollment.findFirst({
      where: and(
        eq(tables.enrollment.id, logRow.entityId),
        eq(tables.enrollment.organizationId, organizationId),
      ),
    });
  }
  if (logRow.entityType === "message") {
    const message = await db.query.message.findFirst({
      where: and(
        eq(tables.message.id, logRow.entityId),
        eq(tables.message.organizationId, organizationId),
      ),
    });
    if (!message?.enrollmentId) return null;
    return db.query.enrollment.findFirst({
      where: and(
        eq(tables.enrollment.id, message.enrollmentId),
        eq(tables.enrollment.organizationId, organizationId),
      ),
    });
  }
  return null;
}

async function ensureContactExternalId(
  ctx: WritebackContext,
  prospect: NonNullable<Awaited<ReturnType<typeof resolveProspectForEntity>>>,
): Promise<string | null> {
  if (prospect.crmExternalId) return prospect.crmExternalId;

  const nango = getNango();
  const input = {
    email: prospect.email,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    title: prospect.title,
    phone: prospect.phone,
  };

  const result =
    ctx.provider === "salesforce"
      ? await upsertSalesforceContact(nango, ctx.nangoConnectionId, input)
      : await upsertHubspotContact(nango, ctx.nangoConnectionId, input);

  await db
    .update(tables.prospect)
    .set({
      crmExternalId: result.externalId,
      crmProvider: ctx.provider,
      crmConnectionId: ctx.connectionId,
    })
    .where(
      and(
        eq(tables.prospect.id, prospect.id),
        eq(tables.prospect.organizationId, ctx.organizationId),
      ),
    );

  return result.externalId;
}

async function performWriteback(
  ctx: WritebackContext,
  eventType: "send" | "reply" | "status" | "contact_upsert",
  logRow: typeof tables.crmWritebackLog.$inferSelect,
): Promise<{ externalId: string; response: unknown }> {
  const prospect = await resolveProspectForEntity(ctx.organizationId, logRow.entityId, logRow);
  if (!prospect) throw new Error("Prospect not found for write-back entity");

  const contactId = await ensureContactExternalId(ctx, prospect);
  if (eventType === "contact_upsert") {
    return { externalId: contactId ?? prospect.id, response: { upserted: true } };
  }

  const nango = getNango();
  const today = new Date().toISOString().slice(0, 10);

  if (eventType === "send" || eventType === "reply") {
    let subject = "Quiksend activity";
    let body = `Event: ${eventType}`;

    if (logRow.entityType === "message") {
      const message = await db.query.message.findFirst({
        where: and(
          eq(tables.message.id, logRow.entityId),
          eq(tables.message.organizationId, ctx.organizationId),
        ),
      });
      if (message) {
        subject = message.subject ?? subject;
        body = message.bodyText ?? message.bodyHtml ?? body;
      }
    }

    if (ctx.provider === "salesforce") {
      return logSalesforceTask(nango, ctx.nangoConnectionId, contactId, {
        subject,
        description: body,
        activityDate: today,
      });
    }
    return logHubspotEngagement(nango, ctx.nangoConnectionId, contactId, {
      subject,
      body,
      timestamp: new Date().toISOString(),
    });
  }

  const enrollment = await resolveEnrollmentState(ctx.organizationId, logRow);
  const state = enrollment?.state ?? "completed";
  const statusValue = ENROLLMENT_STATUS_LABEL[state] ?? state;
  const statusField = DEFAULT_STATUS_FIELD[ctx.provider] ?? "Description";

  if (!contactId) throw new Error("Contact id required for status write-back");

  if (ctx.provider === "salesforce") {
    return updateSalesforceStatus(nango, ctx.nangoConnectionId, contactId, {
      field: statusField,
      value: `Quiksend: ${statusValue}`,
    });
  }
  return updateHubspotStatus(nango, ctx.nangoConnectionId, contactId, {
    field: statusField,
    value: statusValue,
  });
}

export async function registerCrmWritebackHandler(): Promise<void> {
  await registerHandler(
    "crm.writeback",
    async ({ connectionId, eventType, entityId, idempotencyKey, organizationId }) => {
      const existing = await db.query.crmWritebackLog.findFirst({
        where: eq(tables.crmWritebackLog.idempotencyKey, idempotencyKey),
      });

      if (existing?.status === "succeeded") {
        logger.info({ idempotencyKey }, "crm.writeback already succeeded — skipping");
        return;
      }

      const ctx = await loadWritebackContext(connectionId, organizationId);
      if (!ctx) {
        logger.warn({ connectionId }, "crm.writeback: connection not found or inactive");
        return;
      }

      const logRow =
        existing ??
        (await db
          .insert(tables.crmWritebackLog)
          .values({
            organizationId: ctx.organizationId,
            crmConnectionId: connectionId,
            eventType:
              eventType === "status"
                ? "status_update"
                : eventType === "contact_upsert"
                  ? "contact_upsert"
                  : "activity_log",
            entityType: eventType === "contact_upsert" ? "prospect" : "message",
            entityId,
            idempotencyKey,
            status: "pending",
            payload: { eventType },
          })
          .returning()
          .then((rows) => rows[0]));

      if (!logRow) throw new Error("Failed to create crm_writeback_log row");

      const attempts = (logRow.attempts ?? 0) + 1;

      try {
        const result = await performWriteback(ctx, eventType, logRow);
        await db
          .update(tables.crmWritebackLog)
          .set({
            status: "succeeded",
            crmExternalId: result.externalId,
            response: result.response as Record<string, unknown>,
            attempts,
            lastAttemptedAt: new Date(),
            lastError: null,
          })
          .where(
            and(
              eq(tables.crmWritebackLog.id, logRow.id),
              eq(tables.crmWritebackLog.organizationId, ctx.organizationId),
            ),
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(tables.crmWritebackLog)
          .set({
            status: "failed",
            attempts,
            lastAttemptedAt: new Date(),
            lastError: message,
          })
          .where(
            and(
              eq(tables.crmWritebackLog.id, logRow.id),
              eq(tables.crmWritebackLog.organizationId, ctx.organizationId),
            ),
          );
        logger.error({ err, idempotencyKey, connectionId }, "crm.writeback failed");
        throw err;
      }
    },
  );
}
