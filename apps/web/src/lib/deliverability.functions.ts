import { isAdminOrOwner } from "@quiksend/core";
import {
  DEFAULT_CANARY_CONFIG,
  deliverabilitySignal,
  mergeCanaryConfig,
  SEG_GATEWAY_VALUES,
  type CanaryConfig,
  type DeliverabilitySignal,
} from "@quiksend/core/deliverability";
import { withTenantTransaction } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type { EmailGateway } from "@quiksend/mail";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { parseWorkspaceCanaryConfig } from "./canary-injection.ts";
import {
  getOrganizationLimits,
  stripProtectedMetadataKeys,
} from "@quiksend/db/organization-limits";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";

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

export const getDeliverabilityGrid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ windowDays: z.number().int().min(7).max(30) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const windowStart = new Date(Date.now() - data.windowDays * 24 * 60 * 60 * 1000);
      const windowEnd = new Date();

      const snapshots = await tx.query.deliverabilitySnapshot.findMany({
        where: and(
          eq(tables.deliverabilitySnapshot.organizationId, organizationId),
          eq(tables.deliverabilitySnapshot.windowDays, data.windowDays),
        ),
      });

      const mailboxes = await tx.query.mailbox.findMany({
        where: eq(tables.mailbox.organizationId, organizationId),
        columns: { id: true, address: true, displayName: true },
      });

      const rows = mailboxes.map((mailbox) => {
        const cells = SEG_GATEWAY_VALUES.map((gateway) => {
          const snap = snapshots
            .filter((s) => s.mailboxId === mailbox.id && s.gateway === gateway)
            .toSorted((a, b) => b.windowEnd.getTime() - a.windowEnd.getTime())[0];
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
  });

const canaryHistoryCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

function canaryHistoryCursorCondition(cursor: z.infer<typeof canaryHistoryCursorSchema>) {
  const cursorDate = new Date(cursor.createdAt);
  return or(
    lt(tables.canarySend.createdAt, cursorDate),
    and(eq(tables.canarySend.createdAt, cursorDate), lt(tables.canarySend.id, cursor.id)),
  )!;
}

export const getCanaryHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        sequenceId: z.string().uuid().optional(),
        mailboxId: z.string().uuid().optional(),
        gateway: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: canaryHistoryCursorSchema.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const conditions = [eq(tables.canarySend.organizationId, organizationId)];
      if (data.sequenceId) {
        conditions.push(eq(tables.canarySend.sequenceId, data.sequenceId));
      }
      if (data.mailboxId) {
        conditions.push(eq(tables.canarySend.mailboxId, data.mailboxId));
      }
      if (data.gateway) {
        conditions.push(
          inArray(
            tables.canarySend.seedInboxId,
            tx
              .select({ id: tables.seedInbox.id })
              .from(tables.seedInbox)
              .where(eq(tables.seedInbox.gateway, data.gateway as EmailGateway)),
          ),
        );
      }
      if (data.cursor) {
        conditions.push(canaryHistoryCursorCondition(data.cursor));
      }

      const rows = await tx.query.canarySend.findMany({
        where: and(...conditions),
        orderBy: [desc(tables.canarySend.createdAt), desc(tables.canarySend.id)],
        limit: data.limit + 1,
        with: {
          seedInbox: { columns: { email: true, gateway: true } },
          mailbox: { columns: { address: true } },
        },
      });

      const hasMore = rows.length > data.limit;
      const items = hasMore ? rows.slice(0, data.limit) : rows;
      const last = items.at(-1);
      const nextCursor =
        hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : undefined;

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
  });

export const getWorkspaceCanaryConfig = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return withTenantTransaction(context.orgContext.organizationId, async (tx) => {
      const org = await tx.query.organization.findFirst({
        where: eq(tables.organization.id, context.orgContext.organizationId),
        columns: { metadata: true },
      });
      return mergeCanaryConfig(parseWorkspaceCanaryConfig(org?.metadata));
    });
  });

export const setWorkspaceCanaryConfig = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => canaryConfigSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const org = await tx.query.organization.findFirst({
        where: eq(tables.organization.id, organizationId),
        columns: { metadata: true },
      });
      const metadata =
        typeof org?.metadata === "string"
          ? (JSON.parse(org.metadata) as Record<string, unknown>)
          : ((org?.metadata as Record<string, unknown> | null) ?? {});
      const next = stripProtectedMetadataKeys({
        ...metadata,
        canary_defaults: { ...(metadata.canary_defaults as object), ...data },
      });
      await tx
        .update(tables.organization)
        .set({ metadata: JSON.stringify(next) })
        .where(eq(tables.organization.id, organizationId));
      return mergeCanaryConfig(next.canary_defaults as CanaryConfig);
    });

  });

export const getProviderManagedSeedGateways = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return withTenantTransaction(context.orgContext.organizationId, async (tx) => {
      const { deliverabilityPro: entitled } = await getOrganizationLimits(
        context.orgContext.organizationId,
        tx,
      );
      const seeds = entitled
        ? await tx.query.seedInbox.findMany({
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
    });
  });

export const getSequenceDeliverability = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ sequenceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const rows = await tx.execute<{
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

      const org = await tx.query.organization.findFirst({
        where: eq(tables.organization.id, organizationId),
        columns: { metadata: true },
      });
      const seq = await tx.query.sequence.findFirst({
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

      const autoPauseRows = await tx.execute<{ auto_paused: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM event e
          JOIN mailbox mb ON mb.id = (e.payload->>'mailboxId')::uuid
            AND mb.organization_id = e.organization_id
            AND mb.enterprise_safe_auto_downgraded = true
            AND mb.enterprise_safe_reason = 'auto_downgraded'
          JOIN enrollment en ON en.mailbox_id = mb.id
            AND en.sequence_id = e.entity_id
            AND en.organization_id = e.organization_id
            AND en.state = 'paused'
          WHERE e.organization_id = ${organizationId}
            AND e.type = 'canary.silent_drop_detected'
            AND e.entity_type = 'sequence'
            AND e.entity_id = ${data.sequenceId}
        ) AS auto_paused
      `);

      return {
        deliverabilityPct: pct,
        sampleSize: total,
        threshold,
        belowThreshold: pct !== null && pct < threshold,
        autoPaused: Boolean(autoPauseRows[0]?.auto_paused),
      };
    });
  });

export { DEFAULT_CANARY_CONFIG };
