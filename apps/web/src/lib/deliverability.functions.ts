import { isAdminOrOwner } from "@quiksend/core";
import {
  DEFAULT_CANARY_CONFIG,
  deliverabilitySignal,
  mergeCanaryConfig,
  SEG_GATEWAY_VALUES,
  type CanaryConfig,
  type DeliverabilitySignal,
} from "@quiksend/core/deliverability";
import { db, tables } from "@quiksend/db";
import type { EmailGateway } from "@quiksend/mail";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { isDeliverabilityProEntitled, parseWorkspaceCanaryConfig } from "./canary-injection.ts";
import { orgFn } from "./org-fn.ts";

export type { DeliverabilitySignal };

class DeliverabilityError extends Error {
  readonly code: "FORBIDDEN" | "VALIDATION";
  constructor(code: DeliverabilityError["code"], message: string) {
    super(message);
    this.name = "DeliverabilityError";
    this.code = code;
  }
}

function requireAdmin(ctx: { orgContext: { role: string } }): void {
  if (!isAdminOrOwner(ctx.orgContext as never)) {
    throw new DeliverabilityError("FORBIDDEN", "Admin or owner role required");
  }
}

const canaryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  seedsPerCampaign: z.number().int().min(1).max(10).optional(),
  injectionStrategy: z.enum(["random_position", "first_then_last", "every_nth"]).optional(),
  pauseThresholdPct: z.number().int().min(1).max(100).optional(),
});

export const getDeliverabilityGrid = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ windowDays: z.number().int().min(7).max(30) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const windowStart = new Date(Date.now() - data.windowDays * 24 * 60 * 60 * 1000);
    const windowEnd = new Date();

    const snapshots = await db.query.deliverabilitySnapshot.findMany({
      where: and(
        eq(tables.deliverabilitySnapshot.organizationId, organizationId),
        sql`${tables.deliverabilitySnapshot.windowStart} >= ${windowStart}`,
      ),
    });

    const mailboxes = await db.query.mailbox.findMany({
      where: eq(tables.mailbox.organizationId, organizationId),
      columns: { id: true, address: true, displayName: true },
    });

    const rows = mailboxes.map((mailbox) => {
      const cells = SEG_GATEWAY_VALUES.map((gateway) => {
        const snap = snapshots.find((s) => s.mailboxId === mailbox.id && s.gateway === gateway);
        const total = snap?.canaryTotal ?? 0;
        const deliveredInbox = snap?.canaryDelivered ?? 0;
        const pct = snap?.deliverabilityPct ? Number(snap.deliverabilityPct) : null;
        return {
          gateway,
          canaryTotal: total,
          deliveredInbox,
          arrivedSpam: snap?.canarySpam ?? 0,
          arrivedQuarantine: snap?.canaryQuarantine ?? 0,
          silentDropped: snap?.canarySilentDropped ?? 0,
          deliverabilityPct: pct ?? 0,
          signal: deliverabilitySignal(pct, total),
        };
      });
      return {
        mailboxId: mailbox.id,
        mailboxName: mailbox.displayName ?? mailbox.address,
        cells,
      };
    });

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      rows,
    };
  });

export const getCanaryHistory = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        sequenceId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const conditions = [eq(tables.canarySend.organizationId, organizationId)];
    if (data.sequenceId) {
      conditions.push(eq(tables.canarySend.sequenceId, data.sequenceId));
    }
    if (data.cursor) {
      conditions.push(lt(tables.canarySend.id, data.cursor));
    }

    const rows = await db.query.canarySend.findMany({
      where: and(...conditions),
      orderBy: [desc(tables.canarySend.createdAt)],
      limit: data.limit + 1,
      with: {
        seedInbox: { columns: { email: true, gateway: true } },
        mailbox: { columns: { address: true } },
      },
    });

    const hasMore = rows.length > data.limit;
    const items = hasMore ? rows.slice(0, data.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

    return {
      items: items.map((row) => ({
        id: row.id,
        sequenceId: row.sequenceId,
        mailboxAddress: row.mailbox?.address ?? "",
        seedEmail: row.seedInbox?.email ?? "",
        gateway: row.seedInbox?.gateway ?? ("unknown" as EmailGateway),
        subject: row.subject,
        sentAt: row.sentAt?.toISOString() ?? null,
        arrivedAt: row.arrivedAt?.toISOString() ?? null,
        arrivalStatus: row.arrivalStatus,
        arrivalFolder: row.arrivalFolder,
        arrivalGatewayHeaders: row.arrivalGatewayHeaders as Record<string, string> | null,
        canaryToken: row.canaryToken,
      })),
      nextCursor,
    };
  });

export const getWorkspaceCanaryConfig = orgFn({ method: "GET" }).handler(async ({ context }) => {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, context.orgContext.organizationId),
    columns: { metadata: true },
  });
  return mergeCanaryConfig(parseWorkspaceCanaryConfig(org?.metadata));
});

export const setWorkspaceCanaryConfig = orgFn({ method: "POST" })
  .validator((data: unknown) => canaryConfigSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const { organizationId } = context.orgContext;
    const org = await db.query.organization.findFirst({
      where: eq(tables.organization.id, organizationId),
      columns: { metadata: true },
    });
    const metadata =
      typeof org?.metadata === "string"
        ? (JSON.parse(org.metadata) as Record<string, unknown>)
        : ((org?.metadata as Record<string, unknown> | null) ?? {});
    const next = {
      ...metadata,
      canary_defaults: { ...(metadata.canary_defaults as object), ...data },
    };
    await db
      .update(tables.organization)
      .set({ metadata: JSON.stringify(next) })
      .where(eq(tables.organization.id, organizationId));
    return mergeCanaryConfig(next.canary_defaults as CanaryConfig);
  });

export const getProviderManagedSeedGateways = orgFn({ method: "GET" }).handler(
  async ({ context }) => {
    const org = await db.query.organization.findFirst({
      where: eq(tables.organization.id, context.orgContext.organizationId),
      columns: { metadata: true },
    });
    const entitled = isDeliverabilityProEntitled(org?.metadata);
    const seeds = entitled
      ? await db.query.seedInbox.findMany({
          where: isNull(tables.seedInbox.organizationId),
          columns: { gateway: true },
        })
      : [];

    const counts = new Map<EmailGateway, number>();
    for (const seed of seeds) {
      counts.set(seed.gateway, (counts.get(seed.gateway) ?? 0) + 1);
    }

    return SEG_GATEWAY_VALUES.map((gateway) => ({
      gateway,
      seedCount: counts.get(gateway) ?? 0,
      availableForWorkspace: entitled && (counts.get(gateway) ?? 0) > 0,
    }));
  },
);

export const getSequenceDeliverability = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ sequenceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const rows = await db.execute<{
      delivered: string;
      total: string;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE arrival_status = 'arrived_inbox') AS delivered,
        count(*) AS total
      FROM canary_send
      WHERE organization_id = ${organizationId}
        AND sequence_id = ${data.sequenceId}
        AND sent_at > now() - interval '2 hours'
        AND arrival_status <> 'pending'
    `);
    const row = rows[0];
    const delivered = Number(row?.delivered ?? 0);
    const total = Number(row?.total ?? 0);
    const pct = total > 0 ? Math.round((delivered / total) * 100) : null;

    const org = await db.query.organization.findFirst({
      where: eq(tables.organization.id, organizationId),
      columns: { metadata: true },
    });
    const seq = await db.query.sequence.findFirst({
      where: and(
        eq(tables.sequence.id, data.sequenceId),
        eq(tables.sequence.organizationId, organizationId),
      ),
      columns: { canaryConfig: true },
    });
    const threshold = mergeCanaryConfig(
      parseWorkspaceCanaryConfig(org?.metadata),
      seq?.canaryConfig as CanaryConfig | null,
    ).pauseThresholdPct;

    const paused = await db.query.enrollment.findFirst({
      where: and(
        eq(tables.enrollment.sequenceId, data.sequenceId),
        eq(tables.enrollment.organizationId, organizationId),
        eq(tables.enrollment.state, "paused"),
      ),
      columns: { id: true },
    });

    return {
      deliverabilityPct: pct,
      sampleSize: total,
      threshold,
      belowThreshold: pct !== null && pct < threshold,
      autoPaused: Boolean(paused),
    };
  });

export { DEFAULT_CANARY_CONFIG };
