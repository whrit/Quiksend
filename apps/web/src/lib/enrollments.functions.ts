import { db, tables } from "@quiksend/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";

export const enrollWithExistingAnchor = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        prospectId: z.string().uuid(),
        sequenceId: z.string().uuid(),
        existingMessageId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;

    const message = await db.query.message.findFirst({
      where: and(
        eq(tables.message.id, data.existingMessageId),
        eq(tables.message.organizationId, organizationId),
        eq(tables.message.direction, "outbound"),
      ),
    });
    if (!message?.messageIdHeader || !message.sentAt) {
      throw new Error("Anchor message not found or missing send metadata");
    }

    const sequence = await db.query.sequence.findFirst({
      where: and(
        eq(tables.sequence.id, data.sequenceId),
        eq(tables.sequence.organizationId, organizationId),
      ),
    });
    if (!sequence || sequence.status !== "active") {
      throw new Error("Sequence not found or not active");
    }

    const steps = await db.query.sequenceStep.findMany({
      where: and(
        eq(tables.sequenceStep.sequenceId, sequence.id),
        eq(tables.sequenceStep.organizationId, organizationId),
      ),
      orderBy: asc(tables.sequenceStep.stepIndex),
    });
    const firstStep = steps[0];
    if (!firstStep) throw new Error("Sequence has no steps");

    const settings = (sequence.settings ?? {}) as { mailbox_ids?: string[] };
    const mailboxId = message.mailboxId ?? settings.mailbox_ids?.[0];
    if (!mailboxId) throw new Error("No mailbox available for enrollment");

    const nextRunAt = new Date(message.sentAt.getTime() + firstStep.delayMinutes * 60 * 1000);

    const [enrollment] = await db
      .insert(tables.enrollment)
      .values({
        organizationId,
        sequenceId: data.sequenceId,
        prospectId: data.prospectId,
        mailboxId,
        state: "active",
        currentStepIndex: 0,
        nextRunAt,
        anchorMessageId: message.messageIdHeader,
        anchorThreadId: message.providerThreadId,
        createdByUserId: userId,
      })
      .returning();

    if (!enrollment) throw new Error("Failed to create enrollment");

    await db
      .update(tables.message)
      .set({ enrollmentId: enrollment.id })
      .where(eq(tables.message.id, message.id));

    return { enrollmentId: enrollment.id };
  });
