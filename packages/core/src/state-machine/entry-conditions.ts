import type { EmailGateway } from "@quiksend/mail/gateway-detect";
import { z } from "zod";

export const GatewayTypeSchema = z.enum([
  "proofpoint",
  "mimecast",
  "barracuda",
  "cisco_ironport",
  "trend_micro",
  "fortinet",
  "sophos",
  "symantec",
  "google_workspace",
  "microsoft_365",
  "zoho",
  "fastmail",
  "other",
  "unknown",
]);

export const EntryConditionSchema = z.object({
  kind: z.literal("if_no_reply").optional(),
  recipientGatewayIn: z.array(GatewayTypeSchema).optional(),
  recipientGatewayNotIn: z.array(GatewayTypeSchema).optional(),
});

export type EntryCondition = z.infer<typeof EntryConditionSchema>;

export interface EnrollmentContextForCondition {
  hasReplyOnThread: boolean;
  hasBounceOnThread: boolean;
  currentStepIndex: number;
  lastReplyAt: Date | null;
  recipientGateway: EmailGateway | null;
}

export function evaluateEntryCondition(
  condition: EntryCondition | null,
  ctx: EnrollmentContextForCondition,
): { proceed: boolean; skipReason?: string } {
  if (!condition) return { proceed: true };

  if (condition.kind === "if_no_reply" && ctx.hasReplyOnThread) {
    return { proceed: false, skipReason: "if_no_reply: thread has a reply" };
  }

  if (
    condition.recipientGatewayIn &&
    condition.recipientGatewayIn.length > 0 &&
    ctx.recipientGateway &&
    !condition.recipientGatewayIn.includes(ctx.recipientGateway)
  ) {
    return { proceed: false, skipReason: "recipient_gateway_not_in_allow_list" };
  }

  if (
    condition.recipientGatewayNotIn &&
    condition.recipientGatewayNotIn.length > 0 &&
    ctx.recipientGateway &&
    condition.recipientGatewayNotIn.includes(ctx.recipientGateway)
  ) {
    return { proceed: false, skipReason: "recipient_gateway_in_deny_list" };
  }

  return { proceed: true };
}
