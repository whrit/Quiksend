import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { jsonData, jsonError, withApiAuth } from "@/lib/api/v1/middleware.ts";

function sumAtOrAbove(countsByIndex: Map<number, number>, minIndex: number): number {
  let total = 0;
  for (const [index, count] of countsByIndex) {
    if (index >= minIndex) total += count;
  }
  return total;
}

export const Route = createFileRoute("/api/v1/sequences/$id/analytics")({
  server: {
    handlers: {
      GET: ({ request, params }: { request: Request; params: { id: string } }) =>
        withApiAuth(request, async (ctx) => {
          const sequence = await db.query.sequence.findFirst({
            where: and(
              eq(tables.sequence.id, params.id),
              eq(tables.sequence.organizationId, ctx.orgId),
              isNull(tables.sequence.deletedAt),
            ),
          });
          if (!sequence) return jsonError("NOT_FOUND", "Sequence not found", 404);

          const steps = await db.query.sequenceStep.findMany({
            where: and(
              eq(tables.sequenceStep.sequenceId, params.id),
              eq(tables.sequenceStep.organizationId, ctx.orgId),
            ),
          });

          const enrollmentCounts = await db
            .select({
              state: tables.enrollment.state,
              count: sql<number>`count(*)::int`,
            })
            .from(tables.enrollment)
            .where(
              and(
                eq(tables.enrollment.sequenceId, params.id),
                eq(tables.enrollment.organizationId, ctx.orgId),
              ),
            )
            .groupBy(tables.enrollment.state);

          const funnel = enrollmentCounts.reduce<Record<string, number>>((acc, row) => {
            acc[row.state] = row.count;
            return acc;
          }, {});

          const reachedByStepIndex = await db
            .select({
              stepIndex: tables.enrollment.currentStepIndex,
              count: sql<number>`count(*)::int`,
            })
            .from(tables.enrollment)
            .where(
              and(
                eq(tables.enrollment.sequenceId, params.id),
                eq(tables.enrollment.organizationId, ctx.orgId),
              ),
            )
            .groupBy(tables.enrollment.currentStepIndex);

          const reachedCounts = new Map(
            reachedByStepIndex.map((row) => [row.stepIndex, row.count]),
          );

          // Group by the step each message was SENT for, not the enrollment's
          // current position — otherwise every message an enrollment ever sent
          // is attributed to whatever step it has since advanced to.
          // Rows predating sequence_step_index (and manual compose/replies) are
          // null and are excluded rather than misattributed.
          const messagesByStep = await db
            .select({
              stepIndex: tables.message.sequenceStepIndex,
              count: sql<number>`count(*)::int`,
            })
            .from(tables.message)
            .innerJoin(
              tables.enrollment,
              and(
                eq(tables.message.enrollmentId, tables.enrollment.id),
                eq(tables.enrollment.organizationId, ctx.orgId),
              ),
            )
            .where(
              and(
                eq(tables.message.organizationId, ctx.orgId),
                eq(tables.enrollment.sequenceId, params.id),
                eq(tables.message.direction, "outbound"),
                isNotNull(tables.message.sequenceStepIndex),
              ),
            )
            .groupBy(tables.message.sequenceStepIndex);

          const messageCounts = new Map(
            messagesByStep.map((row) => [row.stepIndex as number, row.count]),
          );

          const stepRates = steps.map((step) => ({
            stepIndex: step.stepIndex,
            stepType: step.stepType,
            reached: sumAtOrAbove(reachedCounts, step.stepIndex),
            // Exact count for THIS step, not a cumulative roll-up: each message
            // now carries the step it was sent for, so summing at-or-above would
            // report every later step's sends against this one.
            messagesSent: messageCounts.get(step.stepIndex) ?? 0,
          }));

          return jsonData({
            sequenceId: params.id,
            funnel,
            totalEnrollments: Object.values(funnel).reduce((a, b) => a + b, 0),
            stepRates,
          });
        }),
    },
  },
});
