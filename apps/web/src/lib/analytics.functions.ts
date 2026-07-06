import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";
import { withAnalyticsTiming } from "./timing.ts";

export const getSequenceFunnel = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ sequenceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getSequenceFunnel", organizationId, async () => {
      const [row] = await db
        .select()
        .from(tables.sequenceStats)
        .where(
          and(
            eq(tables.sequenceStats.organizationId, organizationId),
            eq(tables.sequenceStats.sequenceId, data.sequenceId),
          ),
        );

      return {
        enrolled: row?.enrolledCount ?? 0,
        sent: row?.sentCount ?? 0,
        replied: row?.repliedCount ?? 0,
        bounced: row?.bouncedCount ?? 0,
        completed: row?.completedCount ?? 0,
      };
    });
  });

export const getSequenceStepRates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ sequenceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getSequenceStepRates", organizationId, async () => {
      const steps = await db.query.sequenceStep.findMany({
        where: and(
          eq(tables.sequenceStep.organizationId, organizationId),
          eq(tables.sequenceStep.sequenceId, data.sequenceId),
        ),
        orderBy: [tables.sequenceStep.stepIndex],
      });

      const rows = await db.execute<{
        step_index: number;
        sent: number;
        replied: number;
        bounced: number;
      }>(sql`
      SELECT
        ss.step_index,
        COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'sent')::int AS sent,
        COUNT(DISTINCT e.id) FILTER (WHERE e.state = 'replied')::int AS replied,
        COUNT(DISTINCT e.id) FILTER (WHERE e.state = 'bounced')::int AS bounced
      FROM sequence_step ss
      LEFT JOIN enrollment e
        ON e.sequence_id = ss.sequence_id
        AND e.organization_id = ss.organization_id
        AND e.current_step_index >= ss.step_index
      LEFT JOIN message m
        ON m.enrollment_id = e.id
        AND m.organization_id = e.organization_id
        AND m.direction = 'outbound'
      WHERE ss.sequence_id = ${data.sequenceId}
        AND ss.organization_id = ${organizationId}
      GROUP BY ss.step_index
      ORDER BY ss.step_index
    `);

      const rateByStep = new Map(rows.map((r) => [r.step_index, r]));

      return steps.map((step) => {
        const rates = rateByStep.get(step.stepIndex);
        const sent = rates?.sent ?? 0;
        const replied = rates?.replied ?? 0;
        const bounced = rates?.bounced ?? 0;
        return {
          stepIndex: step.stepIndex,
          stepType: step.stepType,
          sent,
          replied,
          bounced,
          replyRate: sent > 0 ? replied / sent : 0,
          bounceRate: sent > 0 ? bounced / sent : 0,
        };
      });
    });
  });

function chiSquarePValue(observed: number[][], nPerVariant: number): number | null {
  if (nPerVariant < 100) return null;
  const rows = observed.length;
  const cols = observed[0]?.length ?? 0;
  if (rows < 2 || cols < 2) return null;

  const rowTotals = observed.map((r) => r.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: cols }, (_, j) =>
    observed.reduce((sum, r) => sum + (r[j] ?? 0), 0),
  );
  const total = rowTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  let chi2 = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const expected = (rowTotals[i]! * colTotals[j]!) / total;
      if (expected <= 0) continue;
      const o = observed[i]![j] ?? 0;
      chi2 += (o - expected) ** 2 / expected;
    }
  }

  const df = (rows - 1) * (cols - 1);
  if (df !== 1) return null;
  return chi2 >= 3.841 ? 0.05 : chi2 >= 2.706 ? 0.1 : 0.5;
}

export const getSequenceABCompare = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ sequenceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getSequenceABCompare", organizationId, async () => {
      const rows = await db
        .select({
          bucket: tables.enrollment.abBucket,
          state: tables.enrollment.state,
          count: sql<number>`count(*)::int`,
        })
        .from(tables.enrollment)
        .where(
          and(
            eq(tables.enrollment.organizationId, organizationId),
            eq(tables.enrollment.sequenceId, data.sequenceId),
          ),
        )
        .groupBy(tables.enrollment.abBucket, tables.enrollment.state);

      type Outcome = "replied" | "completed" | "bounced" | "active";
      type Bucket = "A" | "B";

      const buckets: Bucket[] = ["A", "B"];
      const outcomes: Outcome[] = ["replied", "completed", "bounced", "active"];

      const matrix: Record<Bucket, Record<Outcome, number>> = {
        A: { replied: 0, completed: 0, bounced: 0, active: 0 },
        B: { replied: 0, completed: 0, bounced: 0, active: 0 },
      };

      let nA = 0;
      let nB = 0;
      for (const row of rows) {
        const bucket: Bucket = row.bucket === "B" ? "B" : "A";
        if (bucket === "A") nA += row.count;
        else nB += row.count;
        const state: Outcome = outcomes.includes(row.state as Outcome)
          ? (row.state as Outcome)
          : "active";
        matrix[bucket][state] += row.count;
      }

      const minN = Math.min(nA, nB);
      const note =
        minN < 100
          ? `Sample size too small for significance (n=${minN} per smallest variant; need ≥100).`
          : null;

      const observed: number[][] = buckets.map((b) => [matrix[b].replied, matrix[b].completed]);
      const pValue = chiSquarePValue(observed, minN);

      return {
        variants: buckets.map((bucket) => {
          const total = bucket === "A" ? nA : nB;
          return {
            bucket,
            total,
            replied: matrix[bucket].replied,
            completed: matrix[bucket].completed,
            bounced: matrix[bucket].bounced,
            active: matrix[bucket].active,
            replyRate: total > 0 ? matrix[bucket].replied / total : 0,
          };
        }),
        significance: {
          note,
          pValueApprox: pValue,
          significant: pValue !== null && pValue <= 0.05,
        },
      };
    });
  });

export const getMailboxVolume = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        mailboxId: z.string().uuid(),
        from: z.string().datetime(),
        to: z.string().datetime(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getMailboxVolume", organizationId, async () => {
      const from = new Date(data.from);
      const to = new Date(data.to);

      const rows = await db.execute<{ hour: string; sent: number; bounced: number }>(sql`
      SELECT
        date_trunc('hour', coalesce(m.sent_at, m.received_at, m.created_at))::text AS hour,
        COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE m.bounce_type IS NOT NULL OR m.status = 'bounced')::int AS bounced
      FROM message m
      WHERE m.mailbox_id = ${data.mailboxId}
        AND m.organization_id = ${organizationId}
        AND coalesce(m.sent_at, m.received_at, m.created_at) >= ${from}
        AND coalesce(m.sent_at, m.received_at, m.created_at) <= ${to}
      GROUP BY 1
      ORDER BY 1
    `);

      return rows.map((r) => ({
        hour: r.hour,
        sent: r.sent,
        bounced: r.bounced,
      }));
    });
  });

export const getWorkspaceOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getWorkspaceOverview", organizationId, async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [seqRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tables.sequence)
        .where(
          and(
            eq(tables.sequence.organizationId, organizationId),
            eq(tables.sequence.status, "active"),
            sql`${tables.sequence.deletedAt} is null`,
          ),
        );

      const [enrollRow] = await db
        .select({
          active: sql<number>`count(*) filter (where ${tables.enrollment.state} in ('active', 'waiting', 'waiting_manual', 'paused'))::int`,
        })
        .from(tables.enrollment)
        .where(eq(tables.enrollment.organizationId, organizationId));

      const [replyRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tables.event)
        .where(
          and(
            eq(tables.event.organizationId, organizationId),
            eq(tables.event.type, "reply.received"),
            gte(tables.event.createdAt, weekAgo),
          ),
        );

      const [bounceRow] = await db
        .select({
          sent: sql<number>`count(*) filter (where ${tables.message.status} = 'sent')::int`,
          bounced: sql<number>`count(*) filter (where ${tables.message.bounceType} is not null or ${tables.message.status} = 'bounced')::int`,
        })
        .from(tables.message)
        .where(
          and(
            eq(tables.message.organizationId, organizationId),
            gte(tables.message.createdAt, thirtyDaysAgo),
          ),
        );

      const dailyTrend = await db.execute<{ day: string; replies: number; sent: number }>(sql`
    SELECT
      date_trunc('day', ev.created_at)::text AS day,
      COUNT(*) FILTER (WHERE ev.type = 'reply.received')::int AS replies,
      COUNT(*) FILTER (WHERE ev.type = 'message.sent')::int AS sent
    FROM event ev
    WHERE ev.organization_id = ${organizationId}
      AND ev.created_at >= ${thirtyDaysAgo.toISOString()}
    GROUP BY 1
    ORDER BY 1
  `);

      const sent = bounceRow?.sent ?? 0;
      const bounced = bounceRow?.bounced ?? 0;

      return {
        activeSequences: seqRow?.count ?? 0,
        activeEnrollments: enrollRow?.active ?? 0,
        repliesThisWeek: replyRow?.count ?? 0,
        bounceRate: sent > 0 ? bounced / sent : 0,
        dailyTrend: dailyTrend.map((d) => ({
          day: d.day,
          replies: d.replies,
          sent: d.sent,
        })),
      };
    });
  });

export const getSequencePerformance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getSequencePerformance", organizationId, async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const rows = await db.execute<{
        sequence_id: string;
        sequence_name: string;
        sequence_status: "draft" | "active" | "archived";
        sent: number;
        replied: number;
        bounced: number;
      }>(sql`
        SELECT
          s.id AS sequence_id,
          s.name AS sequence_name,
          s.status AS sequence_status,
          COUNT(*) FILTER (WHERE ev.type = 'message.sent')::int AS sent,
          COUNT(*) FILTER (WHERE ev.type = 'reply.received')::int AS replied,
          COUNT(*) FILTER (WHERE ev.type = 'bounce.received')::int AS bounced
        FROM sequence s
        LEFT JOIN event ev
          ON ev.organization_id = s.organization_id
          AND (ev.payload->>'sequenceId')::uuid = s.id
          AND ev.created_at >= ${thirtyDaysAgo.toISOString()}
        WHERE s.organization_id = ${organizationId}
          AND s.deleted_at IS NULL
        GROUP BY s.id, s.name, s.status
        ORDER BY sent DESC, s.name ASC
      `);

      return rows.map((r) => {
        const sent = r.sent ?? 0;
        const replied = r.replied ?? 0;
        const bounced = r.bounced ?? 0;
        return {
          sequenceId: r.sequence_id,
          sequenceName: r.sequence_name,
          sequenceStatus: r.sequence_status,
          sent,
          replied,
          bounced,
          replyRate: sent > 0 ? replied / sent : 0,
        };
      });
    });
  });

export const getSequenceEventTimeline = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        sequenceId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getSequenceEventTimeline", organizationId, async () => {
      return db.execute<{
        id: string;
        type: string;
        entity_type: string;
        entity_id: string;
        created_at: string;
      }>(sql`
      SELECT id, type, entity_type, entity_id, created_at::text
      FROM event
      WHERE organization_id = ${organizationId}
        AND payload->>'sequenceId' = ${data.sequenceId}
      ORDER BY created_at DESC
      LIMIT ${data.limit}
    `);
    });
  });

export const getProspectWritebackLogs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ prospectId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getProspectWritebackLogs", organizationId, async () => {
      const enrollments = await db.query.enrollment.findMany({
        where: and(
          eq(tables.enrollment.organizationId, organizationId),
          eq(tables.enrollment.prospectId, data.prospectId),
        ),
        columns: { id: true },
      });
      const messages = await db.query.message.findMany({
        where: and(
          eq(tables.message.organizationId, organizationId),
          eq(tables.message.prospectId, data.prospectId),
        ),
        columns: { id: true },
      });

      const entityIds = [
        ...enrollments.map((e) => e.id),
        ...messages.map((m) => m.id),
        data.prospectId,
      ];
      if (entityIds.length === 0) return [];

      const rows = await db.query.crmWritebackLog.findMany({
        where: and(
          eq(tables.crmWritebackLog.organizationId, organizationId),
          inArray(tables.crmWritebackLog.entityId, entityIds),
        ),
        orderBy: [desc(tables.crmWritebackLog.createdAt)],
      });

      return rows.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        entityType: log.entityType,
        entityId: log.entityId,
        status: log.status,
        crmExternalId: log.crmExternalId,
        lastError: log.lastError,
        createdAt: log.createdAt.toISOString(),
        lastAttemptedAt: log.lastAttemptedAt?.toISOString() ?? null,
      }));
    });
  });

export const getMailboxHealthSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ mailboxId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getMailboxHealthSummary", organizationId, async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const mailbox = await db.query.mailbox.findFirst({
        where: and(
          eq(tables.mailbox.id, data.mailboxId),
          eq(tables.mailbox.organizationId, organizationId),
        ),
      });
      if (!mailbox) throw new Error("Mailbox not found");

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [stats] = await db
        .select({
          sentToday: sql<number>`count(*) filter (where ${tables.message.status} = 'sent' and ${tables.message.sentAt} >= ${todayStart})::int`,
          sent30d: sql<number>`count(*) filter (where ${tables.message.status} = 'sent')::int`,
          bounced30d: sql<number>`count(*) filter (where ${tables.message.bounceType} is not null)::int`,
        })
        .from(tables.message)
        .where(
          and(
            eq(tables.message.mailboxId, data.mailboxId),
            eq(tables.message.organizationId, organizationId),
            gte(tables.message.createdAt, thirtyDaysAgo),
          ),
        );

      const sent30d = stats?.sent30d ?? 0;
      const bounced30d = stats?.bounced30d ?? 0;

      return {
        mailbox: {
          id: mailbox.id,
          address: mailbox.address,
          dailyCap: mailbox.dailyCap,
          sentToday: stats?.sentToday ?? 0,
          capUtilization: mailbox.dailyCap > 0 ? (stats?.sentToday ?? 0) / mailbox.dailyCap : 0,
        },
        bounceRate30d: sent30d > 0 ? bounced30d / sent30d : 0,
        sent30d,
        bounced30d,
      };
    });
  });
