import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import {
  transition,
  type EnrollmentSnapshot,
  type StepKind as SmStepKind,
} from "@quiksend/core/state-machine";
import { env } from "@quiksend/config";
import { buildUnsubscribeUrl, mintUnsubscribeToken } from "@quiksend/mail";
import { db, tables } from "@quiksend/db";
import {
  createSmtpTransport,
  decryptSmtpConfig,
  sendMime,
  type ComplianceInput,
} from "@quiksend/mail";
import { buildMime } from "@quiksend/mail/mime";
import { normalizeMessageId } from "@quiksend/mail/threading";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";

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
  subject: z.string().min(1).max(500),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  anchor: anchorSchema.optional(),
});

function parseOrgPostalAddress(metadata: string | null): string {
  if (!metadata) return "1 Main St, City";
  try {
    const parsed = JSON.parse(metadata) as { postal_address?: string };
    return parsed.postal_address?.trim() || "1 Main St, City";
  } catch {
    return "1 Main St, City";
  }
}

async function loadProspect(prospectId: string, organizationId: string) {
  const rows = await db.execute<{
    id: string;
    organization_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  }>(sql`
    select id, organization_id, email, first_name, last_name
    from prospect
    where id = ${prospectId} and organization_id = ${organizationId}
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
  };
}

export const searchProspects = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({ query: z.string().max(200), limit: z.number().int().min(1).max(25).optional() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const q = data.query.trim();
    if (q.length === 0) return [];
    const limit = data.limit ?? 10;
    const pattern = `%${q}%`;
    const rows = await db.execute<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
    }>(sql`
      select id, email, first_name, last_name
      from prospect
      where organization_id = ${context.orgContext.organizationId}
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

export const sendComposedMessage = orgFn({ method: "POST" })
  .validator((data: unknown) => sendComposedMessageSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    });
    if (!mailbox) throw new Error("Mailbox not found");
    if (mailbox.provider !== "smtp") throw new Error("Only SMTP mailboxes are supported in Wave 1");

    if (data.enrollmentId) {
      const enrollment = await db.query.enrollment.findFirst({
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

    const prospect = await loadProspect(data.prospectId, organizationId);

    const org = await db.query.organization.findFirst({
      where: eq(tables.organization.id, organizationId),
    });
    const senderOrgName = org?.name ?? "Quiksend";
    const senderPostalAddress = parseOrgPostalAddress(org?.metadata ?? null);

    const compliance: ComplianceInput = {
      unsubscribeUrl: buildUnsubscribeUrl(
        env.BETTER_AUTH_URL ?? "http://localhost:3000",
        mintUnsubscribeToken({ prospectId: prospect.id, orgId: organizationId }),
      ),
      senderPostalAddress,
      senderOrgName,
    };

    const bodyText = data.bodyText ?? stripHtml(data.bodyHtml);
    const signature = mailbox.signatureHtml ? `\n\n${mailbox.signatureHtml}` : "";

    const mime = buildMime({
      from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
      to: [{ email: prospect.email, name: formatProspectName(prospect) }],
      subject: data.subject,
      html: `${data.bodyHtml}${signature}`,
      text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}`,
      anchor: data.anchor,
      compliance,
    });

    const smtpKey = env.MAILBOX_ENCRYPTION_KEY;
    if (!smtpKey || typeof mailbox.smtpConfig !== "string") {
      throw new Error("Mailbox SMTP configuration is unavailable");
    }
    const smtp = decryptSmtpConfig(mailbox.smtpConfig, smtpKey);

    const sendResult = await sendMime(
      createSmtpTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.auth,
        fromAddress: mailbox.address,
        fromName: mailbox.fromName ?? undefined,
      }),
      mime,
      { from: mailbox.address, to: [prospect.email] },
    );

    const messageIdHeader = normalizeMessageId(sendResult.messageId);
    const threading = data.anchor
      ? {
          inReplyTo: normalizeMessageId(data.anchor.messageId),
          referencesHeader: [
            ...(data.anchor.priorReferences ?? []).map(normalizeMessageId),
            normalizeMessageId(data.anchor.messageId),
          ].join(" "),
        }
      : { inReplyTo: null, referencesHeader: null };

    await db.insert(tables.message).values({
      organizationId,
      mailboxId: mailbox.id,
      prospectId: prospect.id,
      enrollmentId: data.enrollmentId ?? null,
      direction: "outbound",
      subject: mime.subject,
      bodyHtml: data.bodyHtml,
      bodyText,
      messageIdHeader,
      providerMessageId: sendResult.providerMessageId,
      providerThreadId: sendResult.providerThreadId,
      inReplyTo: threading.inReplyTo,
      referencesHeader: threading.referencesHeader,
      status: "sent",
      sentAt: sendResult.sentAt,
    });

    if (data.enrollmentId) {
      await captureManualAnchorForEnrollment({
        enrollmentId: data.enrollmentId,
        organizationId,
        messageId: messageIdHeader,
        threadId: sendResult.providerThreadId ?? messageIdHeader,
        providerMessageId: sendResult.providerMessageId,
        sentAt: sendResult.sentAt,
      });
    }

    return {
      messageId: messageIdHeader,
      providerMessageId: sendResult.providerMessageId,
      sentAt: sendResult.sentAt.toISOString(),
    };
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

type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

function toMailboxSchedule(
  sendWindow: unknown,
  mailbox: { dailyCap: number; throttleSeconds: number },
  settings: SequenceSettings,
): MailboxSchedule {
  const sw = (sendWindow ?? { window: {} }) as {
    timezone?: string;
    window: Record<string, [number, number][]>;
  };
  const window: SendingWindow = {};
  for (const [day, ranges] of Object.entries(sw.window ?? {})) {
    window[day as Weekday] = ranges.map(([start, end]) => ({
      startHour: start,
      endHour: end,
    }));
  }
  return {
    timezone: settings.timezone || sw.timezone || "UTC",
    window,
    dailyCap: mailbox.dailyCap,
    minGapSeconds: settings.throttle_seconds ?? mailbox.throttleSeconds,
  };
}

function computeNextRunAtForEnrollment(
  steps: { stepIndex: number; stepType: string; delayMinutes: number; businessDaysOnly: boolean }[],
  settings: SequenceSettings,
  mailbox: typeof tables.mailbox.$inferSelect,
  stepIndex: number,
  anchor: Date,
): Date | null {
  const specs = steps.map((s) => ({
    index: s.stepIndex,
    kind: s.stepType as StepKind,
    delayMinutes: s.delayMinutes,
    businessDaysOnly: s.businessDaysOnly && settings.business_days_only,
  }));
  const schedule = computeSchedule(
    specs,
    toMailboxSchedule(mailbox.sendWindow, mailbox, settings),
    anchor,
  );
  return schedule.find((s) => s.index === stepIndex)?.scheduledAt ?? null;
}

async function captureManualAnchorForEnrollment(input: {
  enrollmentId: string;
  organizationId: string;
  messageId: string;
  threadId: string;
  providerMessageId: string;
  sentAt: Date;
}): Promise<void> {
  const enrollment = await db.query.enrollment.findFirst({
    where: and(
      eq(tables.enrollment.id, input.enrollmentId),
      eq(tables.enrollment.organizationId, input.organizationId),
    ),
  });
  if (!enrollment) throw new Error("Enrollment not found");

  const steps = await db.query.sequenceStep.findMany({
    where: and(
      eq(tables.sequenceStep.sequenceId, enrollment.sequenceId),
      eq(tables.sequenceStep.organizationId, input.organizationId),
    ),
    orderBy: asc(tables.sequenceStep.stepIndex),
  });

  const sequence = await db.query.sequence.findFirst({
    where: eq(tables.sequence.id, enrollment.sequenceId),
  });
  if (!sequence) throw new Error("Sequence not found");

  const mailbox = await db.query.mailbox.findFirst({
    where: and(
      eq(tables.mailbox.id, enrollment.mailboxId),
      eq(tables.mailbox.organizationId, input.organizationId),
    ),
  });
  if (!mailbox) throw new Error("Mailbox not found");

  const settings = (sequence.settings ?? {}) as SequenceSettings;
  const nextStep = steps.find((s) => s.stepIndex === enrollment.currentStepIndex);
  const hasNext = steps.some((s) => s.stepIndex > enrollment.currentStepIndex);
  const snapshot: EnrollmentSnapshot = {
    state: enrollment.state as EnrollmentSnapshot["state"],
    currentStepIndex: enrollment.currentStepIndex,
    hasNextStep: hasNext,
    nextStepKind: (nextStep?.stepType as SmStepKind) ?? null,
    anchorMessageId: enrollment.anchorMessageId,
    attemptCount: enrollment.attemptCount,
  };

  const { nextState, effects } = transition(snapshot, {
    kind: "manual_sent",
    anchorMessageId: input.messageId,
    anchorThreadId: input.threadId,
    at: input.sentAt,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(tables.message)
      .set({
        enrollmentId: input.enrollmentId,
        providerMessageId: input.providerMessageId,
      })
      .where(
        and(
          eq(tables.message.messageIdHeader, input.messageId),
          eq(tables.message.organizationId, input.organizationId),
        ),
      );

    let currentStepIndex = enrollment.currentStepIndex;
    let anchorMessageId = enrollment.anchorMessageId;
    let anchorThreadId = enrollment.anchorThreadId;
    let attemptCount = enrollment.attemptCount;

    for (const effect of effects) {
      if (effect.kind === "capture_anchor") {
        anchorMessageId = effect.messageId;
        anchorThreadId = effect.threadId;
      }
      if (effect.kind === "advance_step") {
        currentStepIndex += 1;
        attemptCount = 0;
      }
    }

    const nextRunAt = computeNextRunAtForEnrollment(
      steps,
      settings,
      mailbox,
      currentStepIndex,
      input.sentAt,
    );

    await tx
      .update(tables.enrollment)
      .set({
        state: nextState,
        currentStepIndex,
        anchorMessageId,
        anchorThreadId,
        attemptCount,
        nextRunAt,
        lastError: null,
      })
      .where(
        and(
          eq(tables.enrollment.id, input.enrollmentId),
          eq(tables.enrollment.organizationId, input.organizationId),
        ),
      );
  });
}
