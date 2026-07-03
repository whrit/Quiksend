import type { EmailGateway } from "@quiksend/mail/gateway-detect";

export interface CanaryConfig {
  enabled?: boolean;
  seedsPerCampaign?: number;
  injectionStrategy?: "random_position" | "first_then_last" | "every_nth";
  pauseThresholdPct?: number;
  minProspectsPerSeg?: number;
  arrivalWindowMinutes?: number;
}

export const DEFAULT_CANARY_CONFIG: Required<CanaryConfig> = {
  enabled: true,
  seedsPerCampaign: 3,
  injectionStrategy: "random_position",
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
