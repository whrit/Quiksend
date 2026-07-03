import { randomUUID } from "node:crypto";
import {
  isSegGateway,
  mergeCanaryConfig,
  pickInjectionPositions,
  SEG_GATEWAY_VALUES,
  type CanaryConfig,
} from "@quiksend/core/deliverability";
import type { EmailGateway } from "@quiksend/mail";
import { db, tables } from "@quiksend/db";
import { enqueue } from "@quiksend/queue";
import { and, eq, inArray, isNull } from "drizzle-orm";

interface InjectCanariesInput {
  organizationId: string;
  sequenceId: string;
  enrolledProspectIds: readonly string[];
  mailboxIds: readonly string[];
  sequenceCanaryConfig: unknown;
  workspaceCanaryConfig: unknown;
  isProEntitled: boolean;
}

export async function injectCanariesForEnrollment(input: InjectCanariesInput): Promise<number> {
  const config = mergeCanaryConfig(
    input.workspaceCanaryConfig as CanaryConfig | null,
    input.sequenceCanaryConfig as CanaryConfig | null,
  );
  if (!config.enabled || input.enrolledProspectIds.length === 0) return 0;

  const prospects = await db.query.prospect.findMany({
    where: and(
      eq(tables.prospect.organizationId, input.organizationId),
      inArray(tables.prospect.id, [...input.enrolledProspectIds]),
    ),
    columns: { id: true, emailGateway: true },
  });

  const segCounts = new Map<EmailGateway, number>();
  for (const prospect of prospects) {
    const gateway = prospect.emailGateway;
    if (!gateway || !isSegGateway(gateway)) continue;
    segCounts.set(gateway, (segCounts.get(gateway) ?? 0) + 1);
  }

  const eligibleSegs = [...segCounts.entries()].filter(
    ([, count]) => count >= config.minProspectsPerSeg,
  );
  if (eligibleSegs.length === 0) return 0;

  const userSeeds = await db.query.seedInbox.findMany({
    where: and(
      eq(tables.seedInbox.organizationId, input.organizationId),
      eq(tables.seedInbox.active, true),
    ),
  });

  let providerSeeds: (typeof tables.seedInbox.$inferSelect)[] = [];
  if (input.isProEntitled) {
    providerSeeds = await db.query.seedInbox.findMany({
      where: and(isNull(tables.seedInbox.organizationId), eq(tables.seedInbox.active, true)),
    });
  }

  const steps = await db.query.sequenceStep.findMany({
    where: and(
      eq(tables.sequenceStep.sequenceId, input.sequenceId),
      eq(tables.sequenceStep.organizationId, input.organizationId),
      eq(tables.sequenceStep.stepType, "auto_email"),
    ),
    columns: { stepIndex: true },
    orderBy: (s, { asc }) => [asc(s.stepIndex)],
  });
  const stepIndices = steps.map((s) => s.stepIndex);
  if (stepIndices.length === 0) return 0;

  let created = 0;
  let mailboxIndex = 0;
  const seedRoundRobin = new Map<EmailGateway, number>();

  for (const [gateway] of eligibleSegs) {
    const seedsForGateway = [
      ...userSeeds.filter((s) => s.gateway === gateway),
      ...providerSeeds.filter((s) => s.gateway === gateway),
    ];
    if (seedsForGateway.length === 0) continue;

    const positions = pickInjectionPositions(
      stepIndices,
      config.seedsPerCampaign,
      config.injectionStrategy,
      config.everyNth,
    );
    for (let i = 0; i < config.seedsPerCampaign; i++) {
      const rr = seedRoundRobin.get(gateway) ?? 0;
      const seed = seedsForGateway[rr % seedsForGateway.length];
      if (!seed) continue;
      seedRoundRobin.set(gateway, rr + 1);

      const mailboxId = input.mailboxIds[mailboxIndex % input.mailboxIds.length];
      if (!mailboxId) continue;
      mailboxIndex++;

      const canaryToken = randomUUID();
      const stepIndex = positions[i] ?? stepIndices[0]!;
      const [row] = await db
        .insert(tables.canarySend)
        .values({
          organizationId: input.organizationId,
          sequenceId: input.sequenceId,
          mailboxId,
          seedInboxId: seed.id,
          canaryToken,
          stepIndex,
          subject: `Canary ${gateway}`,
        })
        .returning({ id: tables.canarySend.id });

      if (!row) continue;
      created++;

      const delayMinutes = stepIndex * 5;
      const startAfter = delayMinutes * 60;
      await enqueue("canary.send", { canarySendId: row.id }, { startAfter });
    }
  }

  return created;
}

export function parseWorkspaceCanaryConfig(metadata: unknown): CanaryConfig | null {
  if (!metadata) return null;
  const parsed =
    typeof metadata === "string"
      ? (JSON.parse(metadata) as Record<string, unknown>)
      : (metadata as Record<string, unknown>);
  const defaults = parsed.canary_defaults;
  return defaults && typeof defaults === "object" ? (defaults as CanaryConfig) : null;
}

export function isDeliverabilityProEntitled(metadata: unknown): boolean {
  const parsed =
    typeof metadata === "string"
      ? (JSON.parse(metadata) as Record<string, unknown>)
      : (metadata as Record<string, unknown> | null);
  const entitlements = parsed?.entitlements as
    | { deliverability_pro?: { activeUntil?: string } }
    | undefined;
  const until = entitlements?.deliverability_pro?.activeUntil;
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

export { SEG_GATEWAY_VALUES };
