import { mergeCanaryConfig } from "@quiksend/core/deliverability";
import { db, tables } from "@quiksend/db";
import type { EmailGateway } from "@quiksend/mail";
import { inArray } from "drizzle-orm";

export interface PauseGroupKey {
  sequenceId: string;
  mailboxId: string;
  gateway: EmailGateway;
  organizationId: string;
}

export interface PauseContext {
  sequenceId: string;
  sequenceName: string;
  canaryConfig: unknown;
  threshold: number;
}

function pauseGroupCacheKey(group: PauseGroupKey): string {
  return `${group.organizationId}:${group.sequenceId}:${group.mailboxId}:${group.gateway}`;
}

function parseOrgMetadata(metadata: unknown): { canary_defaults?: unknown } | null {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as { canary_defaults?: unknown };
    } catch {
      return null;
    }
  }
  return metadata as { canary_defaults?: unknown };
}

/**
 * Batch-loads sequence + org canary config for auto-pause groups (CR-24).
 * OMICRON's maybePauseCampaigns should import this instead of per-row findFirst.
 */
export async function loadPauseContext(
  groups: readonly PauseGroupKey[],
): Promise<Map<string, PauseContext>> {
  if (groups.length === 0) return new Map();

  const sequenceIds = [...new Set(groups.map((g) => g.sequenceId))];
  const organizationIds = [...new Set(groups.map((g) => g.organizationId))];

  const [sequences, organizations] = await Promise.all([
    db.query.sequence.findMany({
      where: inArray(tables.sequence.id, sequenceIds),
      columns: { id: true, name: true, canaryConfig: true },
    }),
    db.query.organization.findMany({
      where: inArray(tables.organization.id, organizationIds),
      columns: { id: true, metadata: true },
    }),
  ]);

  const sequenceById = new Map(sequences.map((s) => [s.id, s]));
  const orgMetaById = new Map(organizations.map((org) => [org.id, parseOrgMetadata(org.metadata)]));

  const result = new Map<string, PauseContext>();
  for (const group of groups) {
    const sequence = sequenceById.get(group.sequenceId);
    if (!sequence) continue;

    const orgMeta = orgMetaById.get(group.organizationId);
    const threshold = mergeCanaryConfig(
      orgMeta?.canary_defaults as never,
      sequence.canaryConfig as never,
    ).pauseThresholdPct;

    result.set(pauseGroupCacheKey(group), {
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      canaryConfig: sequence.canaryConfig,
      threshold,
    });
  }

  return result;
}
