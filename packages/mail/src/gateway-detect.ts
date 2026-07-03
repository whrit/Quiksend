import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resolveMxRecords, resolveTxtRecords } from "./dns.ts";

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

export type GatewayConfidence = "high" | "medium" | "low";

export interface GatewayEvidence {
  kind: "mx" | "spf" | "dmarc" | "arc_seal" | "heuristic";
  detail: string;
}

export interface GatewayDetectionResult {
  gateway: EmailGateway;
  evidence: GatewayEvidence[];
  confidence: GatewayConfidence;
  mxRecords: string[];
}

const EmailGatewaySchema = z.enum([
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

const fingerprintSchema = z.object({
  pattern: z.string().min(1),
  gateway: EmailGatewaySchema,
  confidence: z.enum(["high", "medium", "low"]),
});

const fingerprintsFileSchema = z.array(fingerprintSchema);

interface CompiledFingerprint {
  pattern: RegExp;
  gateway: EmailGateway;
  confidence: GatewayConfidence;
}

const SEG_GATEWAYS = new Set<EmailGateway>([
  "proofpoint",
  "mimecast",
  "barracuda",
  "cisco_ironport",
  "trend_micro",
  "fortinet",
  "sophos",
  "symantec",
]);

const DMARC_SEG_HINTS: Array<{ pattern: RegExp; gateway: EmailGateway; detail: string }> = [
  {
    pattern: /pphosted|pphmx|proofpoint/i,
    gateway: "proofpoint",
    detail: "DMARC rua points to Proofpoint",
  },
  {
    pattern: /mimecast/i,
    gateway: "mimecast",
    detail: "DMARC rua points to Mimecast",
  },
  {
    pattern: /barracudanetworks/i,
    gateway: "barracuda",
    detail: "DMARC rua points to Barracuda",
  },
];

const SPF_SEG_HINTS: Array<{ pattern: RegExp; gateway: EmailGateway; detail: string }> = [
  {
    pattern: /include:_spf\.pphosted\.com/i,
    gateway: "proofpoint",
    detail: "SPF includes Proofpoint",
  },
  {
    pattern: /include:.*mimecast/i,
    gateway: "mimecast",
    detail: "SPF includes Mimecast",
  },
  {
    pattern: /include:.*barracudanetworks/i,
    gateway: "barracuda",
    detail: "SPF includes Barracuda",
  },
  {
    pattern: /include:.*iphmx/i,
    gateway: "cisco_ironport",
    detail: "SPF includes Cisco IronPort",
  },
];

function loadFingerprints(): CompiledFingerprint[] {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "gateway-fingerprints.json"), "utf8");
  const parsed = fingerprintsFileSchema.parse(JSON.parse(raw));
  return parsed.map((entry) => ({
    pattern: new RegExp(entry.pattern, "i"),
    gateway: entry.gateway,
    confidence: entry.confidence,
  }));
}

const MX_FINGERPRINTS = loadFingerprints();

const RFC6761_SUFFIXES = [".local", ".internal", ".test", ".example", ".invalid"] as const;
const SINGLE_LABEL_ALLOWLIST = new Set<string>();

/** Reject domains unsuitable for DNS classification (RFC 1035 + RFC 6761). */
export function validateClassificationDomain(
  domain: string,
): { ok: true } | { ok: false; detail: string } {
  const normalized = domain.trim().toLowerCase().replace(/^@/, "");
  if (normalized.length === 0 || normalized.length > 253) {
    return { ok: false, detail: "blocked domain shape" };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) {
    return { ok: false, detail: "blocked domain shape" };
  }
  for (const suffix of RFC6761_SUFFIXES) {
    const bare = suffix.slice(1);
    if (normalized === bare || normalized.endsWith(suffix)) {
      return { ok: false, detail: "blocked domain shape" };
    }
  }
  const labels = normalized.split(".");
  if (labels.some((label) => label.length === 0)) {
    return { ok: false, detail: "blocked domain shape" };
  }
  if (labels.length === 1 && !SINGLE_LABEL_ALLOWLIST.has(normalized)) {
    return { ok: false, detail: "blocked domain shape" };
  }
  for (const label of labels) {
    if (label.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label)) {
      return { ok: false, detail: "blocked domain shape" };
    }
  }
  return { ok: true };
}

function extractDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

interface MxMatch {
  gateway: EmailGateway;
  confidence: GatewayConfidence;
  exchange: string;
}

function matchMxFingerprints(exchanges: string[]): MxMatch[] {
  const matches: MxMatch[] = [];
  for (const exchange of exchanges) {
    for (const fp of MX_FINGERPRINTS) {
      if (fp.pattern.test(exchange)) {
        matches.push({
          gateway: fp.gateway,
          confidence: fp.confidence,
          exchange,
        });
      }
    }
  }
  return matches;
}

function pickMxGateway(
  matches: MxMatch[],
): { gateway: EmailGateway; confidence: GatewayConfidence } | null {
  if (matches.length === 0) return null;

  const segMatches = matches.filter((m) => SEG_GATEWAYS.has(m.gateway));
  if (segMatches.length > 0) {
    const best = segMatches[0]!;
    return { gateway: best.gateway, confidence: best.confidence };
  }

  const best = matches[0]!;
  return { gateway: best.gateway, confidence: best.confidence };
}

async function inspectDmarc(
  domain: string,
): Promise<{ gateway: EmailGateway; detail: string } | null> {
  const records = await resolveTxtRecords(`_dmarc.${domain}`);
  for (const chunks of records) {
    const joined = chunks.join("");
    if (!joined.toLowerCase().startsWith("v=dmarc1")) continue;
    for (const hint of DMARC_SEG_HINTS) {
      if (hint.pattern.test(joined)) {
        return { gateway: hint.gateway, detail: hint.detail };
      }
    }
  }
  return null;
}

async function inspectSpf(
  domain: string,
): Promise<{ gateway: EmailGateway; detail: string } | null> {
  const records = await resolveTxtRecords(domain);
  for (const chunks of records) {
    const joined = chunks.join("");
    if (!joined.toLowerCase().startsWith("v=spf1")) continue;
    for (const hint of SPF_SEG_HINTS) {
      if (hint.pattern.test(joined)) {
        return { gateway: hint.gateway, detail: hint.detail };
      }
    }
  }
  return null;
}

function unknownResult(
  evidence: GatewayEvidence[],
  mxRecords: string[],
  confidence: GatewayConfidence = "low",
): GatewayDetectionResult {
  return {
    gateway: "unknown",
    evidence,
    confidence,
    mxRecords,
  };
}

/**
 * Detect the email gateway for the given email address via MX → DMARC → SPF cascade.
 */
export async function detectEmailGateway(email: string): Promise<GatewayDetectionResult> {
  const domain = extractDomain(email);
  if (!domain) {
    return unknownResult([{ kind: "heuristic", detail: "Invalid email address" }], []);
  }

  const shape = validateClassificationDomain(domain);
  if (!shape.ok) {
    return unknownResult([{ kind: "heuristic", detail: shape.detail }], []);
  }

  const mx = await resolveMxRecords(domain);
  const mxRecords = mx.records.map((r) => r.exchange);
  const evidence: GatewayEvidence[] = [];

  if (mx.error) {
    evidence.push({ kind: "mx", detail: mx.error });
    if (/timeout/i.test(mx.error)) {
      return unknownResult(evidence, mxRecords, "low");
    }
    if (/servfail/i.test(mx.error)) {
      return unknownResult(evidence, mxRecords, "low");
    }
    return unknownResult(evidence, mxRecords, "low");
  }

  if (mxRecords.length === 0) {
    evidence.push({ kind: "mx", detail: "No MX records found (misconfigured domain)" });
    return unknownResult(evidence, mxRecords, "low");
  }

  for (const exchange of mxRecords) {
    evidence.push({ kind: "mx", detail: `MX: ${exchange}` });
  }

  const mxMatches = matchMxFingerprints(mxRecords);
  const mxPick = pickMxGateway(mxMatches);
  if (mxPick && mxPick.confidence === "high") {
    return {
      gateway: mxPick.gateway,
      evidence,
      confidence: mxPick.confidence,
      mxRecords,
    };
  }

  const dmarc = await inspectDmarc(domain);
  if (dmarc) {
    evidence.push({ kind: "dmarc", detail: dmarc.detail });
    return {
      gateway: dmarc.gateway,
      evidence,
      confidence: "medium",
      mxRecords,
    };
  }

  const spf = await inspectSpf(domain);
  if (spf) {
    evidence.push({ kind: "spf", detail: spf.detail });
    return {
      gateway: spf.gateway,
      evidence,
      confidence: "medium",
      mxRecords,
    };
  }

  if (mxPick) {
    return {
      gateway: mxPick.gateway,
      evidence,
      confidence: mxPick.confidence,
      mxRecords,
    };
  }

  return unknownResult(evidence, mxRecords, "low");
}

/** Exported for unit tests — recompile fingerprints from raw JSON entries. */
export function compileFingerprintsForTest(
  entries: Array<{ pattern: string; gateway: EmailGateway; confidence: GatewayConfidence }>,
): CompiledFingerprint[] {
  return entries.map((entry) => ({
    pattern: new RegExp(entry.pattern, "i"),
    gateway: entry.gateway,
    confidence: entry.confidence,
  }));
}

export { MX_FINGERPRINTS, SEG_GATEWAYS, matchMxFingerprints, pickMxGateway, extractDomain };
