import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  injectCanariesForEnrollment,
  isDeliverabilityProEntitled,
  parseWorkspaceCanaryConfig,
} from "@/lib/canary-injection.ts";
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
    throttle_seconds: s.throttle_seconds ?? 90,
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

function computeNextRunAt(
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

          const seq = await db.query.sequence.findFirst({
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

          const steps = await db.query.sequenceStep.findMany({
            where: and(
              eq(tables.sequenceStep.sequenceId, seq.id),
              eq(tables.sequenceStep.organizationId, ctx.orgId),
            ),
            orderBy: asc(tables.sequenceStep.stepIndex),
          });

          const mailboxes = await db.query.mailbox.findMany({
            where: and(
              eq(tables.mailbox.organizationId, ctx.orgId),
              inArray(tables.mailbox.id, settings.mailbox_ids),
            ),
          });
          if (mailboxes.length === 0) {
            return jsonError("VALIDATION", "No valid mailboxes found", 400);
          }

          const prospects = await db.query.prospect.findMany({
            where: and(
              eq(tables.prospect.organizationId, ctx.orgId),
              inArray(tables.prospect.id, parsed.data.prospectIds),
              isNull(tables.prospect.deletedAt),
            ),
          });
          const prospectSet = new Set(prospects.map((p) => p.id));
          const prospectById = new Map(prospects.map((p) => [p.id, p]));

          // Suppression check: block prospects whose email (or domain) is on
          // the workspace suppression list. Matches the server-fn behavior in
          // sequences.functions.ts:enrollProspects; kept inline here so the REST
          // route doesn't grow a cross-import into a UI-facing module.
          const suppressedEmails = await loadSuppressedEmailsForRest(
            ctx.orgId,
            prospects.map((p) => p.email),
          );

          const existing = await db.query.enrollment.findMany({
            where: and(
              eq(tables.enrollment.sequenceId, seq.id),
              eq(tables.enrollment.organizationId, ctx.orgId),
              inArray(tables.enrollment.prospectId, parsed.data.prospectIds),
            ),
          });
          const alreadyEnrolled = new Set(existing.map((e) => e.prospectId));

          const enrolled: string[] = [];
          const skipped: string[] = [];
          const anchor = new Date();
          let mailboxIndex = 0;

          for (const prospectId of parsed.data.prospectIds) {
            if (!prospectSet.has(prospectId) || alreadyEnrolled.has(prospectId)) {
              skipped.push(prospectId);
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
                skipped.push(prospectId);
                continue;
              }
            }

            const mailbox = mailboxes[mailboxIndex % mailboxes.length];
            if (!mailbox) continue;
            mailboxIndex++;

            const nextRunAt = computeNextRunAt(steps, settings, mailbox, 0, anchor);

            try {
              await db.insert(tables.enrollment).values({
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
            } catch {
              skipped.push(prospectId);
            }
          }

          // Canary injection: same as the server-fn path so a REST enroll gets
          // the same deliverability safety net.
          const org = await db.query.organization.findFirst({
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

          return jsonData({
            enrolled: enrolled.length,
            skipped: skipped.length,
            skippedIds: skipped,
            canariesCreated,
          });
        }),
    },
  },
});

function emailDomainLower(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}

async function loadSuppressedEmailsForRest(
  organizationId: string,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const normalized = emails.map((e) => e.toLowerCase());
  const domains = [...new Set(normalized.map(emailDomainLower))];
  const rows = await db.query.suppression.findMany({
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
        if (emailDomainLower(email) === row.value) suppressed.add(email);
      }
    }
  }
  return suppressed;
}
