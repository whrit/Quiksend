import type { EmailGateway } from "@quiksend/mail/gateway-detect";

export interface CanaryConfig {
  enabled?: boolean;
  seedsPerCampaign?: number;
  injectionStrategy?: "random_position" | "first_then_last" | "every_nth";
  everyNth?: number;
  pauseThresholdPct?: number;
  minProspectsPerSeg?: number;
  arrivalWindowMinutes?: number;
}

export const DEFAULT_CANARY_CONFIG: Required<CanaryConfig> = {
  enabled: true,
  seedsPerCampaign: 3,
  injectionStrategy: "random_position",
  everyNth: 2,
  pauseThresholdPct: 80,
  minProspectsPerSeg: 5,
  arrivalWindowMinutes: 15,
};

export function mergeCanaryConfig(
  workspace?: CanaryConfig | null,
  sequence?: CanaryConfig | null,
): Required<CanaryConfig> {
  return {
    ...DEFAULT_CANARY_CONFIG,
    ...workspace,
    ...sequence,
    enabled: sequence?.enabled ?? workspace?.enabled ?? DEFAULT_CANARY_CONFIG.enabled,
  };
}

export type InjectionStrategy = NonNullable<CanaryConfig["injectionStrategy"]>;

/** Picks sequence step indices for canary injection based on workspace strategy. */
export function pickInjectionPositions(
  stepIndices: readonly number[],
  count: number,
  strategy: InjectionStrategy = "random_position",
  everyNth = 2,
): number[] {
  if (stepIndices.length === 0 || count <= 0) return [];

  switch (strategy) {
    case "first_then_last":
      return pickFirstThenLast(stepIndices, count);
    case "every_nth":
      return pickEveryNth(stepIndices, count, everyNth);
    case "random_position":
    default:
      return pickRandomPositions(stepIndices, count);
  }
}

function pickFirstThenLast(stepIndices: readonly number[], count: number): number[] {
  const first = stepIndices[0]!;
  const last = stepIndices[stepIndices.length - 1]!;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i % 2 === 0 ? first : last);
  }
  return out;
}

function pickEveryNth(stepIndices: readonly number[], count: number, everyNth: number): number[] {
  const n = Math.max(1, everyNth);
  const pool = stepIndices.filter((_, idx) => idx % n === 0);
  const source = pool.length > 0 ? pool : [...stepIndices];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(source[i % source.length]!);
  }
  return out;
}

function pickRandomPositions(stepIndices: readonly number[], count: number): number[] {
  const pool = [...stepIndices];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) {
      out.push(stepIndices[i % stepIndices.length]!);
      continue;
    }
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

export type DeliverabilitySignal = "green" | "yellow" | "red" | "insufficient_data";

export function deliverabilitySignal(pct: number | null, total: number): DeliverabilitySignal {
  if (total < 3) return "insufficient_data";
  if (pct === null) return "insufficient_data";
  if (pct >= 90) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

export const SEG_GATEWAY_VALUES: readonly EmailGateway[] = [
  "proofpoint",
  "mimecast",
  "barracuda",
  "cisco_ironport",
  "trend_micro",
  "fortinet",
  "sophos",
  "symantec",
] as const;
