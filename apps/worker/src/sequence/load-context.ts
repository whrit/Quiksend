import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, asc, eq } from "drizzle-orm";
import { parseDeliverabilityPolicy } from "@quiksend/core/deliverability";
import type { EnrollmentContext, SequenceSettings, StepContext } from "./context.ts";

function parseSettings(raw: unknown): SequenceSettings {
  const value = (raw ?? {}) as Partial<SequenceSettings>;
  return {
    timezone: value.timezone ?? "UTC",
    throttle_seconds: value.throttle_seconds ?? 90,
    mailbox_ids: value.mailbox_ids ?? [],
    stop_on_reply: value.stop_on_reply ?? true,
    business_days_only: value.business_days_only ?? true,
  };
}

export async function loadContext(enrollmentId: string): Promise<EnrollmentContext> {
  const enrollment = await db.query.enrollment.findFirst({
    where: eq(tables.enrollment.id, enrollmentId),
  });
  if (!enrollment) throw new Error(`Enrollment not found: ${enrollmentId}`);

  const sequence = await db.query.sequence.findFirst({
    where: and(
      eq(tables.sequence.id, enrollment.sequenceId),
      eq(tables.sequence.organizationId, enrollment.organizationId),
    ),
  });
  if (!sequence) throw new Error(`Sequence not found for enrollment ${enrollmentId}`);

  const stepRows = await db.query.sequenceStep.findMany({
    where: and(
      eq(tables.sequenceStep.sequenceId, sequence.id),
      eq(tables.sequenceStep.organizationId, enrollment.organizationId),
    ),
    orderBy: asc(tables.sequenceStep.stepIndex),
  });

  const steps: StepContext[] = stepRows.map((row) => ({
    id: row.id,
    stepIndex: row.stepIndex,
    stepType: row.stepType as StepContext["stepType"],
    delayMinutes: row.delayMinutes,
    businessDaysOnly: row.businessDaysOnly,
    config: row.config as StepContext["config"],
  }));

  const mailbox = await db.query.mailbox.findFirst({
    where: and(
      eq(tables.mailbox.id, enrollment.mailboxId),
      eq(tables.mailbox.organizationId, enrollment.organizationId),
    ),
  });
  if (!mailbox) throw new Error(`Mailbox not found for enrollment ${enrollmentId}`);

  const prospect = await db.query.prospect.findFirst({
    where: and(
      eq(tables.prospect.id, enrollment.prospectId),
      eq(tables.prospect.organizationId, enrollment.organizationId),
    ),
  });
  if (!prospect) throw new Error(`Prospect not found for enrollment ${enrollmentId}`);

  const company = prospect.companyId
    ? await db.query.company.findFirst({
        where: and(
          eq(tables.company.id, prospect.companyId),
          eq(tables.company.organizationId, enrollment.organizationId),
        ),
      })
    : null;

  const createdBy = await db.query.user.findFirst({
    where: eq(tables.user.id, enrollment.createdByUserId),
  });

  let anchorMessage: EnrollmentContext["anchorMessage"] = null;
  if (enrollment.anchorMessageId) {
    const anchor = await db.query.message.findFirst({
      where: and(
        eq(tables.message.messageIdHeader, enrollment.anchorMessageId),
        eq(tables.message.organizationId, enrollment.organizationId),
      ),
    });
    if (anchor?.messageIdHeader && anchor.sentAt) {
      anchorMessage = {
        id: anchor.id,
        messageIdHeader: anchor.messageIdHeader,
        subject: anchor.subject,
        providerThreadId: anchor.providerThreadId,
        sentAt: anchor.sentAt,
        referencesHeader: anchor.referencesHeader,
      };
    }
  }

  const priorOutbound = await db.query.message.findMany({
    where: and(
      eq(tables.message.enrollmentId, enrollment.id),
      eq(tables.message.organizationId, enrollment.organizationId),
      eq(tables.message.direction, "outbound"),
    ),
    orderBy: asc(tables.message.sentAt),
  });

  const settings = parseSettings(sequence.settings);

  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, enrollment.organizationId),
    columns: { metadata: true },
  });
  const deliverabilityPolicy = parseDeliverabilityPolicy(org?.metadata);

  return {
    enrollmentId: enrollment.id,
    organizationId: enrollment.organizationId,
    enrollment,
    sequence,
    settings,
    steps,
    mailbox,
    prospect: {
      id: prospect.id,
      email: prospect.email,
      firstName: prospect.firstName,
      lastName: prospect.lastName,
      title: prospect.title,
      status: prospect.status,
      emailGateway: prospect.emailGateway,
    },
    company: company ? { name: company.name, domain: company.domain } : null,
    anchorMessage,
    priorOutbound: priorOutbound.map((m) => ({
      messageIdHeader: m.messageIdHeader,
      sentAt: m.sentAt,
    })),
    stopOnReply: settings.stop_on_reply,
    senderFirstName: createdBy?.name?.split(" ")[0] ?? null,
    senderSignature: mailbox.signatureHtml,
    deliverabilityPolicy,
  };
}
