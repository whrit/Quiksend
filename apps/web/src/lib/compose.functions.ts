import { env } from "@quiksend/config";
import { buildUnsubscribeUrl, mintUnsubscribeToken, resolvePostalAddress } from "@quiksend/mail";
import { isSendSuppressed, type DbTx, withTenantTransaction } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { sendAndRecord } from "./durable-send.ts";
import { buildThreadingHeaders, normalizeMessageId } from "@quiksend/mail/threading";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { captureManualAnchorForEnrollment } from "./anchor.functions.ts";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";
import { getMailboxAdapter } from "./mailbox-adapter.ts";

const anchorSchema = z.object({
  messageId: z.string().min(1),
  subject: z.string().min(1),
  providerThreadId: z.string().nullable().optional(),
  priorReferences: z.array(z.string()).optional(),
});

const sendComposedMessageSchema = z.object({
  mailboxId: z.string().uuid(),
  prospectId: z.string().uuid(),
  enrollmentId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  subject: z.string().min(1).max(500),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  anchor: anchorSchema.optional(),
});

async function loadProspect(tx: DbTx, prospectId: string, organizationId: string) {
  const rows = await tx.execute<{
    id: string;
    organization_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    status: string;
  }>(sql`
    select id, organization_id, email, first_name, last_name, status
    from prospect
    where id = ${prospectId} and organization_id = ${organizationId}
      and deleted_at is null
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("Prospect not found");
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status,
  };
}

export const searchProspects = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({ query: z.string().max(200), limit: z.number().int().min(1).max(25).optional() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const q = data.query.trim();
    if (q.length === 0) return [];
    const limit = data.limit ?? 10;
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const pattern = `%${q}%`;
      const rows = await tx.execute<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
      }>(sql`
        select id, email, first_name, last_name
        from prospect
        where organization_id = ${organizationId}
          and deleted_at is null
          and (
            email ilike ${pattern}
            or coalesce(first_name, '') ilike ${pattern}
            or coalesce(last_name, '') ilike ${pattern}
          )
        order by email asc
        limit ${limit}
      `);
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        label: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
      }));
    });
  });

export const sendComposedMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => sendComposedMessageSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    return withTenantTransaction(organizationId, async (tx) => {
      const mailbox = await tx.query.mailbox.findFirst({
        where: and(
          eq(tables.mailbox.id, data.mailboxId),
          eq(tables.mailbox.organizationId, organizationId),
        ),
      });
      if (!mailbox) throw new Error("Mailbox not found");
      if (mailbox.status === "archived") throw new Error("Mailbox is archived");

      if (data.enrollmentId) {
        const enrollment = await tx.query.enrollment.findFirst({
          where: and(
            eq(tables.enrollment.id, data.enrollmentId),
            eq(tables.enrollment.organizationId, organizationId),
          ),
        });
        if (!enrollment) throw new Error("Enrollment not found");
        if (enrollment.mailboxId !== data.mailboxId) {
          throw new Error(
            "Mailbox must match the enrollment mailbox — follow-ups must continue on the same thread",
          );
        }
      }

      // Validate taskId belongs to this enrollment and organization
      if (data.taskId) {
        if (!data.enrollmentId) {
          throw new Error("taskId requires enrollmentId");
        }
        const task = await tx.query.task.findFirst({
          where: and(
            eq(tables.task.id, data.taskId),
            eq(tables.task.organizationId, organizationId),
            eq(tables.task.enrollmentId, data.enrollmentId),
            eq(tables.task.type, "compose"),
          ),
        });
        if (!task) throw new Error("Compose task not found for this enrollment");
        // Fail-closed: terminal task must not trigger another send
        if (task.status !== "open" && task.status !== "in_progress") {
          throw new Error("Compose task is already resolved");
        }
      }

      const prospect = await loadProspect(tx, data.prospectId, organizationId);

      if (
        await isSendSuppressed({
          organizationId,
          email: prospect.email,
          prospectStatus: prospect.status,
        })
      ) {
        throw new Error("This prospect is suppressed (unsubscribed, bounced, or do-not-contact)");
      }

      const org = await tx.query.organization.findFirst({
        where: eq(tables.organization.id, organizationId),
      });
      const senderOrgName = org?.name ?? "Quiksend";
      const senderPostalAddress = resolvePostalAddress({
        organizationId,
        metadata: org?.metadata ?? null,
      });

      const compliance = {
        unsubscribeUrl: buildUnsubscribeUrl(
          env.BETTER_AUTH_URL ?? "http://localhost:3000",
          mintUnsubscribeToken({ prospectId: prospect.id, orgId: organizationId }),
        ),
        senderPostalAddress,
        senderOrgName,
      };

      const bodyText = data.bodyText ?? stripHtml(data.bodyHtml);
      const signature = mailbox.signatureHtml ? `\n\n${mailbox.signatureHtml}` : "";

      const threading = data.anchor
        ? buildThreadingHeaders({
            messageId: data.anchor.messageId,
            subject: data.subject,
            providerThreadId: data.anchor.providerThreadId,
            priorReferences: data.anchor.priorReferences,
          })
        : null;

      const threadingMeta = data.anchor
        ? {
            inReplyTo: normalizeMessageId(data.anchor.messageId),
            referencesHeader: [
              ...(data.anchor.priorReferences ?? []).map(normalizeMessageId),
              normalizeMessageId(data.anchor.messageId),
            ].join(" "),
          }
        : { inReplyTo: null, referencesHeader: null };

      const adapter = getMailboxAdapter(mailbox, compliance);
      const { messageId: messageIdHeader, result: sendResult } = await sendAndRecord(
        organizationId,
        {
          organizationId,
          mailboxId: mailbox.id,
          prospectId: prospect.id,
          enrollmentId: data.enrollmentId ?? null,
          direction: "outbound",
          subject: threading?.subject ?? data.subject,
          bodyHtml: data.bodyHtml,
          bodyText,
          inReplyTo: threadingMeta.inReplyTo,
          referencesHeader: threadingMeta.referencesHeader,
        },
        () =>
          adapter.send({
            from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
            to: [{ email: prospect.email, name: formatProspectName(prospect) }],
            subject: threading?.subject ?? data.subject,
            html: `${data.bodyHtml}${signature}`,
            text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}`,
            threading: threading ?? undefined,
          }),
      );

      if (data.enrollmentId) {
        await captureManualAnchorForEnrollment({
          enrollmentId: data.enrollmentId,
          organizationId,
          messageId: messageIdHeader,
          threadId: sendResult.providerThreadId ?? messageIdHeader,
          providerMessageId: sendResult.providerMessageId ?? messageIdHeader,
          sentAt: sendResult.sentAt,
        });

        // Mark compose task done — idempotent: only updates open/in_progress tasks
        if (data.taskId) {
          await tx
            .update(tables.task)
            .set({ status: "done", completedAt: new Date() })
            .where(
              and(
                eq(tables.task.id, data.taskId),
                eq(tables.task.organizationId, organizationId),
                inArray(tables.task.status, ["open", "in_progress"]),
              ),
            );
        }
      }

      return {
        messageId: messageIdHeader,
        providerMessageId: sendResult.providerMessageId,
        sentAt: sendResult.sentAt.toISOString(),
      };
    });
  });

function formatProspectName(prospect: {
  firstName: string | null;
  lastName: string | null;
}): string | undefined {
  const name = [prospect.firstName, prospect.lastName].filter(Boolean).join(" ");
  return name.length > 0 ? name : undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
