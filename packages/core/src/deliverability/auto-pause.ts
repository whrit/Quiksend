import type { EmailGateway } from "@quiksend/mail/gateway-detect";

export interface CanaryStats {
  sequenceId: string;
  mailboxId: string;
  gateway: EmailGateway;
  delivered: number;
  total: number;
}

export interface AutoPauseDecision {
  action: "pause" | "no_action";
  reason?: string;
  deliverabilityPct?: number;
  threshold?: number;
}

const MIN_CANARIES_FOR_SIGNAL = 3;

/**
 * Pure evaluator for canary auto-pause. Returns pause when delivery rate falls
 * below threshold with enough samples for signal.
 */
export function evaluateAutoPause(stats: CanaryStats, threshold: number): AutoPauseDecision {
  if (stats.total < MIN_CANARIES_FOR_SIGNAL) {
    return { action: "no_action" };
  }

  const deliverabilityPct = Math.round((stats.delivered / stats.total) * 100);

  if (deliverabilityPct < threshold) {
    return {
      action: "pause",
      reason: "canary_deliverability_below_threshold",
      deliverabilityPct,
      threshold,
    };
  }

  return { action: "no_action", deliverabilityPct, threshold };
}
