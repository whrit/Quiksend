// packages/mail/src/gateway-detect.ts
// Phase 11A entry point — real implementation ships in Track TAU.
// This file exists so Track UPSILON and Track PHI can import types without
// waiting on TAU's implementation.

export type EmailGateway =
  | "proofpoint"
  | "mimecast"
  | "barracuda"
  | "cisco_ironport"
  | "trend_micro"
  | "fortinet"
  | "sophos"
  | "symantec"
  | "google_workspace"
  | "microsoft_365"
  | "zoho"
  | "fastmail"
  | "other"
  | "unknown";

export interface GatewayEvidence {
  kind: "mx" | "spf" | "dmarc" | "arc_seal" | "heuristic";
  detail: string;
}

export interface GatewayDetectionResult {
  gateway: EmailGateway;
  evidence: GatewayEvidence[];
  confidence: "high" | "medium" | "low";
  mxRecords: string[];
}

/**
 * Detect the email gateway for the given email address.
 *
 * Track TAU (Phase 11A) implements this. Foundation ships a stub that throws so
 * consumers can import the type + reference the symbol at type-check time.
 */
export async function detectEmailGateway(_email: string): Promise<GatewayDetectionResult> {
  throw new Error(
    "Phase 11A not yet implemented — see docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md",
  );
}
