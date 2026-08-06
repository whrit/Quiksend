import { emailDomain } from "@quiksend/core";
import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import { type DbTx, withTenantTransaction } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  injectCanariesForEnrollment,
  isDeliverabilityProEntitled,
  parseWorkspaceCanaryConfig,
} from "@/lib/canary-injection.ts";
import { isEnrollmentDuplicate } from "@/lib/sequences.functions.ts";
import { jsonData, jsonError, parseJsonBody, withApiAuth } from "@/lib/api/v1/middleware.ts";

type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

function parseSettings(raw: unknown): SequenceSettings {
  const s = (raw ?? {}) as Partial<SequenceSettings>;
  return {
    timezone: s.timezone ?? "UTC",
    throttle_seconds: s.throttle_seconds ?? 120,
    mailbox_ids: s.mailbox_ids ?? [],
    stop_on_reply: s.stop_on_reply ?? true,
    business_days_only: s.business_days_only ?? true,
  };
}

function toMailboxSchedule(
  sendWindow: unknown,
  mailbox: { dailyCap: number; throttleSeconds: number },
  settings: SequenceSettings,
): MailboxSchedule {
  const sw = (sendWindow ?? { window: {} }) as {
    window: Record<string, [number, number][]>;
  };
  const window: SendingWindow = {};
  for (const [day, ranges] of Object.entries(sw.window ?? {})) {
    window[day as Weekday] = ranges.map(([start, end]) => ({
      startMinute: start,
      endMinute: end,
    }));
  }
  return {
    dailyCap: mailbox.dailyCap,
    throttleSeconds: Math.max(mailbox.throttleSeconds, settings.throttle_seconds),
    timezone: settings.timezone,
    sendWindow: window,
  };
}

function computeNextRunAt(
  steps: { stepIndex: number; stepType: string; delayMinutes: number; businessDaysOnly: boolean }[],
  settings: SequenceSettings,
  mailbox: typeof tables.mailbox.$inferSelect,
  stepIndex: number,
  anchor: Date,
): Date | null {
  const specs: {
    index: number;
    kind: StepKind;
    delayMinutes: number;
    businessDaysOnly: boolean;
  }[] = steps.map((s) => ({
    index: s.stepIndex,
    kind: s.stepType as StepKind,
    delayMinutes: s.delayMinutes,
    businessDaysOnly: s.businessDaysOnly,
  }));
  const schedule = toMailboxSchedule(mailbox.sendWindow, mailbox, settings);
  const result = computeSchedule(specs, schedule, anchor);
  return result[stepIndex]?.scheduledAt ?? null;
}

export const Route = createFileRoute("/api/v1/enrollments")({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const body = await parseJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError("INVALID_JSON", "Request body must be valid JSON", 400);

          const parsed = z
            .object({
              sequenceId: z.string().uuid(),
              prospectIds: z.array(z.string().uuid()).min(1).max(500),
            })
            .safeParse(body);

          if (!parsed.success) return jsonError("VALIDATION", parsed.error.message, 400);

          return withTenantTransaction(ctx.orgId, async (tx) => {
            const seq = await tx.query.sequence.findFirst({
              where: and(
                eq(tables.sequence.id, parsed.data.sequenceId),
                eq(tables.sequence.organizationId, ctx.orgId),
                isNull(tables.sequence.deletedAt),
              ),
            });
            if (!seq || seq.status !== "active") {
              return jsonError("INVALID_STATE", "Sequence not found or not active", 400);
            }

            const settings = parseSettings(seq.settings);
            if (settings.mailbox_ids.length === 0) {
              return jsonError("VALIDATION", "Sequence has no mailboxes configured", 400);
            }

            const steps = await tx.query.sequenceStep.findMany({
              where: and(
                eq(tables.sequenceStep.sequenceId, seq.id),
                eq(tables.sequenceStep.organizationId, ctx.orgId),
              ),
              orderBy: asc(tables.sequenceStep.stepIndex),
            });

            const mailboxes = await tx.query.mailbox.findMany({
              where: and(
                eq(tables.mailbox.organizationId, ctx.orgId),
                inArray(tables.mailbox.id, settings.mailbox_ids),
                eq(tables.mailbox.status, "active"),
              ),
            });
            if (mailboxes.length === 0) {
              return jsonError(
                "VALIDATION",
                "No active mailboxes configured for this sequence — resume or reconnect a mailbox before enrolling",
                400,
              );
            }

            const prospects = await tx.query.prospect.findMany({
              where: and(
                eq(tables.prospect.organizationId, ctx.orgId),
                inArray(tables.prospect.id, parsed.data.prospectIds),
                isNull(tables.prospect.deletedAt),
              ),
            });
            const prospectSet = new Set(prospects.map((p) => p.id));
            const prospectById = new Map(prospects.map((p) => [p.id, p]));

            // Suppression check: block prospects whose email (or domain) is on
            // the workspace suppression list.
            const suppressedEmails = await loadSuppressedEmailsForRest(
              tx,
              ctx.orgId,
              prospects.map((p) => p.email),
            );

            const existing = await tx.query.enrollment.findMany({
              where: and(
                eq(tables.enrollment.sequenceId, seq.id),
                eq(tables.enrollment.organizationId, ctx.orgId),
                inArray(tables.enrollment.prospectId, parsed.data.prospectIds),
              ),
            });
            const alreadyEnrolled = new Set(existing.map((e) => e.prospectId));

            const enrolled: string[] = [];
            const skipped: string[] = [];
            const skipReasons: Record<string, EnrollmentSkipReason> = {};
            const skipProspect = (prospectId: string, reason: EnrollmentSkipReason) => {
              skipped.push(prospectId);
              skipReasons[prospectId] = reason;
            };
            const anchor = new Date();
            let mailboxIndex = 0;

            for (const prospectId of parsed.data.prospectIds) {
              if (!prospectSet.has(prospectId)) {
                skipProspect(prospectId, "not_found");
                continue;
              }
              if (alreadyEnrolled.has(prospectId)) {
                skipProspect(prospectId, "already_enrolled");
                continue;
              }

              const prospect = prospectById.get(prospectId);
              if (prospect) {
                const email = prospect.email.toLowerCase();
                if (
                  suppressedEmails.has(email) ||
                  prospect.status === "unsubscribed" ||
                  prospect.status === "do_not_contact" ||
                  prospect.status === "bounced"
                ) {
                  skipProspect(prospectId, "suppressed");
                  continue;
                }
              }

              const mailbox = mailboxes[mailboxIndex % mailboxes.length]!;
              mailboxIndex++;

              const nextRunAt = computeNextRunAt(steps, settings, mailbox, 0, anchor);

              try {
                await tx.insert(tables.enrollment).values({
                  organizationId: ctx.orgId,
                  sequenceId: seq.id,
                  prospectId,
                  mailboxId: mailbox.id,
                  state: "active",
                  currentStepIndex: 0,
                  nextRunAt,
                  abBucket: Math.random() < 0.5 ? "A" : "B",
                  createdByUserId: ctx.userId,
                });
                enrolled.push(prospectId);
                alreadyEnrolled.add(prospectId);
              } catch (err) {
                if (isEnrollmentDuplicate(err)) {
                  skipProspect(prospectId, "conflict");
                  continue;
                }
                throw err;
              }
            }

            // Canary injection: same as the server-fn path so a REST enroll gets
            // the same deliverability safety net.
            const org = await tx.query.organization.findFirst({
              where: eq(tables.organization.id, ctx.orgId),
              columns: { metadata: true },
            });
            const canariesCreated = await injectCanariesForEnrollment({
              organizationId: ctx.orgId,
              sequenceId: seq.id,
              enrolledProspectIds: enrolled,
              mailboxIds: mailboxes.map((m) => m.id),
              sequenceCanaryConfig: seq.canaryConfig,
              workspaceCanaryConfig: parseWorkspaceCanaryConfig(org?.metadata),
              isProEntitled: isDeliverabilityProEntitled(org?.metadata),
            });

            return jsonData(
              {
                enrolled: enrolled.length,
                skipped: skipped.length,
                skippedIds: skipped,
                skipReasons,
                canariesCreated,
              },
              201,
            );
          });

        }),
    },
  },
});

type EnrollmentSkipReason = "not_found" | "already_enrolled" | "suppressed" | "conflict";

async function loadSuppressedEmailsForRest(
  tx: DbTx,
  organizationId: string,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const normalized = emails.map((e) => e.toLowerCase());
  const domains = [...new Set(normalized.map(emailDomain))];
  const rows = await tx.query.suppression.findMany({
    where: and(
      eq(tables.suppression.organizationId, organizationId),
      inArray(tables.suppression.value, [...normalized, ...domains]),
    ),
  });
  const suppressed = new Set<string>();
  for (const row of rows) {
    if (row.valueType === "email") {
      suppressed.add(row.value);
    } else if (row.valueType === "domain") {
      for (const email of normalized) {
        if (emailDomain(email) === row.value) suppressed.add(email);
      }
    }
  }
  return suppressed;
}
