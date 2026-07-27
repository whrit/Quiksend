import {
  isSegGateway,
  mergeCanaryConfig,
  parseDeliverabilityPolicy,
} from "@quiksend/core/deliverability";
import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import {
  buildMime,
  sanitizeForSeg,
  sendMime,
  createSmtpTransport,
  mintUnsubscribeToken,
  buildUnsubscribeUrl,
  buildComplianceParts,
} from "@quiksend/mail";
import { enqueue } from "@quiksend/queue";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createMailboxAdapter } from "../sequence/mailbox-adapter.ts";
import { renderTemplate, stripHtml } from "../sequence/render-template.ts";
import type { EmailStepConfig, SequenceSettings } from "../sequence/context.ts";
import {
  markReservationSent,
  releaseReservation,
  reserveSendSlot,
} from "../sequence/reserve-slot.ts";
import { getWorkspacePostalAddress } from "../sequence/workspace-postal.ts";

/** Sentinel prospect id for seed canary sends — recognized by the unsubscribe handler. */
export const CANARY_UNSUBSCRIBE_PROSPECT_ID = "00000000-0000-4000-a000-000000000001";

const ARRIVAL_WINDOW_MINUTES = 15;

export async function materializeCanarySend(canarySendId: string): Promise<void> {
  const row = await db.query.canarySend.findFirst({
    where: eq(tables.canarySend.id, canarySendId),
  });
  if (!row || row.sentAt) return;

  const [sequence, mailbox, seedInbox, org] = await Promise.all([
    db.query.sequence.findFirst({
      where: and(
        eq(tables.sequence.id, row.sequenceId),
        eq(tables.sequence.organizationId, row.organizationId),
      ),
    }),
    db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, row.mailboxId),
        eq(tables.mailbox.organizationId, row.organizationId),
      ),
    }),
    db.query.seedInbox.findFirst({
      where: eq(tables.seedInbox.id, row.seedInboxId),
    }),
    db.query.organization.findFirst({
      where: eq(tables.organization.id, row.organizationId),
      columns: { metadata: true },
    }),
  ]);

  if (!sequence || !mailbox || !seedInbox || !seedInbox.active) {
    return;
  }

  const enrollmentId = await resolveReservationEnrollmentId(row);
  if (!enrollmentId) return;

  const settings = parseSequenceSettings(sequence.settings);
  const at = new Date();
  const slot = await reserveSendSlot(mailbox.id, enrollmentId, row.organizationId, at, settings, {
    recipientEmail: seedInbox.email,
    recipientGateway: seedInbox.gateway,
  });

  if (!slot.ok) {
    const delaySec = Math.max(60, Math.ceil((slot.deferUntil.getTime() - Date.now()) / 1000));
    await enqueue(
      "canary.send",
      { canarySendId },
      { startAfter: delaySec, singletonKey: `canary.send:${canarySendId}` },
    );
    return;
  }

  const steps = await db.query.sequenceStep.findMany({
    where: and(
      eq(tables.sequenceStep.sequenceId, sequence.id),
      eq(tables.sequenceStep.organizationId, row.organizationId),
    ),
    orderBy: (s, { asc }) => [asc(s.stepIndex)],
  });

  const autoSteps = steps.filter((s) => s.stepType === "auto_email");
  const step = resolveCanaryStep(autoSteps, row.stepIndex, row.canaryToken);
  if (!step) {
    await releaseReservation(slot.reservationId);
    return;
  }

  const config = step.config as EmailStepConfig;
  const shortId = row.canaryToken.replace(/-/g, "").slice(0, 8);
  const templateCtx = {
    firstName: "Canary",
    lastName: "Test",
    email: seedInbox.email,
    title: "Deliverability",
    companyName: "Canary Corp",
    companyDomain: seedInbox.email.split("@")[1] ?? "example.com",
    senderFirstName: mailbox.fromName?.split(" ")[0] ?? "Sender",
    senderSignature: mailbox.signatureHtml ?? "",
  };

  const subject = `${renderTemplate(config.subject, templateCtx)} [Q${shortId}]`;
  let bodyHtml = renderTemplate(config.body_template, templateCtx);
  let bodyText = stripHtml(bodyHtml);
  const signature = mailbox.signatureHtml ? `\n\n${mailbox.signatureHtml}` : "";

  const metadataRaw =
    typeof org?.metadata === "string"
      ? org.metadata
      : org?.metadata
        ? JSON.stringify(org.metadata)
        : null;
  const deliverabilityPolicy = parseDeliverabilityPolicy(metadataRaw);
  const shouldSanitize =
    deliverabilityPolicy.contentSanitizerEnabled && isSegGateway(seedInbox.gateway);
  if (shouldSanitize) {
    const sanitized = sanitizeForSeg(
      { html: bodyHtml, text: bodyText },
      {
        stripTrackingPixel: true,
        stripExternalImages: true,
        preferPlainText: true,
      },
    );
    bodyHtml = sanitized.html;
    bodyText = sanitized.text;
  }

  const token = mintUnsubscribeToken({
    prospectId: CANARY_UNSUBSCRIBE_PROSPECT_ID,
    orgId: row.organizationId,
  });
  const baseUrl = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const senderPostalAddress = await getWorkspacePostalAddress(row.organizationId);
  const complianceInput = {
    unsubscribeUrl: buildUnsubscribeUrl(baseUrl, token),
    senderPostalAddress,
    senderOrgName: sequence.name,
  };
  const compliance = buildComplianceParts(complianceInput);

  const mime = buildMime({
    from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
    to: [{ email: seedInbox.email, name: "Canary Test" }],
    subject,
    html: `${bodyHtml}${signature}${compliance.footerHtml}`,
    text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}${compliance.footerText}`,
    compliance: complianceInput,
    canaryToken: row.canaryToken,
  });

  const adapter = createMailboxAdapter(mailbox, row.organizationId);
  const sentAt = new Date();

  try {
    if (mailbox.provider === "smtp" && env.SMTP_HOST) {
      const transport = createSmtpTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 1025,
        secure: false,
        fromAddress: mailbox.address,
        fromName: mailbox.fromName ?? undefined,
        compliance: complianceInput,
      });
      await sendMime(transport, mime, {
        from: mailbox.address,
        to: [seedInbox.email],
      });
    } else {
      await adapter.send({
        from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
        to: [{ email: seedInbox.email, name: "Canary Test" }],
        subject,
        html: `${bodyHtml}${signature}${compliance.footerHtml}`,
        text: `${bodyText}${compliance.footerText}`,
        extraHeaders: { "X-Quiksend-Canary-Id": row.canaryToken },
        idempotencyKey: `canary:${row.canaryToken}`,
      });
    }
  } catch (err) {
    await releaseReservation(slot.reservationId);
    throw err;
  }

  await markReservationSent(slot.reservationId);

  const configMerged = mergeCanaryConfig(
    parseOrgCanaryDefaults(parseOrgMetadata(org?.metadata)),
    sequence.canaryConfig as never,
  );
  const expectedArrivalAt = new Date(
    sentAt.getTime() + configMerged.arrivalWindowMinutes * 60 * 1000,
  );

  await db
    .update(tables.canarySend)
    .set({
      subject,
      sentAt,
      expectedArrivalAt,
    })
    .where(
      and(
        eq(tables.canarySend.id, row.id),
        eq(tables.canarySend.organizationId, row.organizationId),
        isNull(tables.canarySend.sentAt),
      ),
    );
}

async function resolveReservationEnrollmentId(
  row: typeof tables.canarySend.$inferSelect,
): Promise<string | null> {
  if (row.enrollmentId) return row.enrollmentId;

  const enrollment = await db.query.enrollment.findFirst({
    where: and(
      eq(tables.enrollment.organizationId, row.organizationId),
      eq(tables.enrollment.sequenceId, row.sequenceId),
      eq(tables.enrollment.mailboxId, row.mailboxId),
      inArray(tables.enrollment.state, ["active", "waiting", "waiting_manual", "paused"]),
    ),
    columns: { id: true },
  });
  return enrollment?.id ?? null;
}

function parseSequenceSettings(raw: unknown): SequenceSettings {
  const settings = (raw ?? {}) as Partial<SequenceSettings>;
  return {
    timezone: settings.timezone ?? "UTC",
    throttle_seconds: settings.throttle_seconds ?? 90,
    mailbox_ids: settings.mailbox_ids ?? [],
    stop_on_reply: settings.stop_on_reply ?? true,
    business_days_only: settings.business_days_only ?? true,
  };
}

function resolveCanaryStep(
  autoSteps: (typeof tables.sequenceStep.$inferSelect)[],
  persistedStepIndex: number | null | undefined,
  canaryToken: string,
): typeof tables.sequenceStep.$inferSelect | undefined {
  if (autoSteps.length === 0) return undefined;
  if (persistedStepIndex != null) {
    const matched = autoSteps.find((s) => s.stepIndex === persistedStepIndex);
    if (matched) return matched;
  }
  return autoSteps[hashToIndex(canaryToken, autoSteps.length)] ?? autoSteps[0];
}

function parseOrgMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return metadata as Record<string, unknown>;
}

function parseOrgCanaryDefaults(metadata: Record<string, unknown> | null) {
  const raw = metadata?.canary_defaults;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function hashToIndex(token: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

export { ARRIVAL_WINDOW_MINUTES };
