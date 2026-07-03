import { randomUUID } from "node:crypto";
import {
  isSegGateway,
  mergeCanaryConfig,
  parseDeliverabilityPolicy,
} from "@quiksend/core/deliverability";
import { env } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import {
  buildComplianceParts,
  buildMime,
  buildUnsubscribeUrl,
  extractRecipientDomain,
  mintUnsubscribeToken,
  sanitizeForSeg,
  sendMime,
  createSmtpTransport,
} from "@quiksend/mail";
import { enqueue } from "@quiksend/queue";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { createMailboxAdapter } from "../sequence/mailbox-adapter.ts";
import { renderTemplate, stripHtml } from "../sequence/render-template.ts";
import { getWorkspacePostalAddress } from "../sequence/workspace-postal.ts";
import type { EmailStepConfig } from "../sequence/context.ts";

const ARRIVAL_WINDOW_MINUTES = 15;
const DOMAIN_GAP_MS = 5 * 60 * 1000;

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

  const throttle = await checkCanaryDomainGap(mailbox.id, seedInbox.email, new Date());
  if (!throttle.ok) {
    const delaySec = Math.max(60, Math.ceil((throttle.deferUntil.getTime() - Date.now()) / 1000));
    await enqueue("canary.send", { canarySendId }, { startAfter: delaySec });
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
  if (!step) return;

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
    prospectId: row.id,
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

  const configMerged = mergeCanaryConfig(
    parseOrgCanaryDefaults(await loadOrgMetadata(row.organizationId)),
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

async function checkCanaryDomainGap(
  mailboxId: string,
  recipientEmail: string,
  at: Date,
): Promise<{ ok: true } | { ok: false; deferUntil: Date }> {
  const recipientDomain = extractRecipientDomain(recipientEmail);
  if (!recipientDomain) return { ok: true };

  const since = new Date(at.getTime() - DOMAIN_GAP_MS);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tables.sendReservation)
    .where(
      and(
        eq(tables.sendReservation.mailboxId, mailboxId),
        eq(tables.sendReservation.recipientDomain, recipientDomain),
        gte(tables.sendReservation.reservedAt, since),
        inArray(tables.sendReservation.status, ["held", "sent"]),
      ),
    );

  if ((rows[0]?.count ?? 0) >= 1) {
    return { ok: false, deferUntil: new Date(at.getTime() + DOMAIN_GAP_MS) };
  }
  return { ok: true };
}

async function loadOrgMetadata(organizationId: string): Promise<Record<string, unknown> | null> {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, organizationId),
    columns: { metadata: true },
  });
  if (!org?.metadata) return null;
  if (typeof org.metadata === "string") {
    try {
      return JSON.parse(org.metadata) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return org.metadata as Record<string, unknown>;
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

export function newCanaryToken(): string {
  return randomUUID();
}

export { ARRIVAL_WINDOW_MINUTES };
