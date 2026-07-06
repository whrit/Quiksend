import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull, sql } from "drizzle-orm";
import { jsonData, jsonError, withApiAuth } from "@/lib/api/v1/middleware.ts";

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

          const stepRates = await Promise.all(
            steps.map(async (step) => {
              const reached = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(tables.enrollment)
                .where(
                  and(
                    eq(tables.enrollment.sequenceId, params.id),
                    eq(tables.enrollment.organizationId, ctx.orgId),
                    sql`${tables.enrollment.currentStepIndex} >= ${step.stepIndex}`,
                  ),
                );
              const sent = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(tables.message)
                .where(
                  and(
                    eq(tables.message.organizationId, ctx.orgId),
                    sql`${tables.message.enrollmentId} in (select id from enrollment where sequence_id = ${params.id} and organization_id = ${ctx.orgId} and current_step_index >= ${step.stepIndex})`,
                  ),
                );
              return {
                stepIndex: step.stepIndex,
                stepType: step.stepType,
                reached: reached[0]?.count ?? 0,
                messagesSent: sent[0]?.count ?? 0,
              };
            }),
          );

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
