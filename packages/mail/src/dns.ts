import * as dns from "node:dns/promises";

export type SpfMode = "strict" | "softfail" | "neutral" | null;

export interface MxRecord {
  readonly exchange: string;
  readonly priority: number;
}

export interface ResolveMxResult {
  readonly records: MxRecord[];
  readonly error: string | null;
}

const DEFAULT_MX_TIMEOUT_MS = 5_000;
const DEFAULT_TXT_TIMEOUT_MS = 5_000;

/** Resolve MX records for a domain with a timeout. Returns empty records on failure. */
export async function resolveMxRecords(
  domain: string,
  timeoutMs = DEFAULT_MX_TIMEOUT_MS,
): Promise<ResolveMxResult> {
  const normalized = domain.trim().toLowerCase().replace(/^@/, "");
  try {
    const records = await Promise.race([
      dns.resolveMx(normalized),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("MX lookup timeout")), timeoutMs);
      }),
    ]);
    const sorted = [...records].toSorted((a, b) => a.priority - b.priority);
    return {
      records: sorted.map((r) => ({
        exchange: r.exchange.toLowerCase(),
        priority: r.priority,
      })),
      error: null,
    };
  } catch (err) {
    return {
      records: [],
      error: err instanceof Error ? err.message : "MX lookup failed",
    };
  }
}

export async function resolveTxtRecords(
  host: string,
  timeoutMs = DEFAULT_TXT_TIMEOUT_MS,
): Promise<string[][]> {
  const normalized = host.trim().toLowerCase().replace(/^@/, "");
  try {
    return await Promise.race([
      dns.resolveTxt(normalized),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("TXT lookup timeout")), timeoutMs);
      }),
    ]);
  } catch {
    return [];
  }
}

export interface DomainAuthResult {
  readonly spf: {
    readonly pass: boolean;
    readonly reason: string | null;
    readonly record: string | null;
    readonly mode: SpfMode;
  };
  readonly dkim: {
    readonly pass: boolean;
    readonly reason: string | null;
    readonly record: string | null;
    readonly selectors_found: readonly string[];
  };
  readonly dmarc: {
    readonly pass: boolean;
    readonly reason: string | null;
    readonly record: string | null;
    readonly policy: "none" | "quarantine" | "reject" | null;
  };
}

const DKIM_SELECTORS = ["default", "google", "k1", "selector1", "selector2"] as const;

/** DNS-based SPF/DKIM/DMARC presence checks for a sending domain. */
export async function checkDomainAuth(domain: string): Promise<DomainAuthResult> {
  const normalized = domain.trim().toLowerCase().replace(/^@/, "");
  const [spf, dkim, dmarc] = await Promise.all([
    checkSpf(normalized),
    checkDkim(normalized),
    checkDmarc(normalized),
  ]);
  return { spf, dkim, dmarc };
}

async function checkSpf(domain: string): Promise<DomainAuthResult["spf"]> {
  try {
    const records = await dns.resolveTxt(domain);
    for (const chunks of records) {
      const joined = chunks.join("");
      if (!joined.toLowerCase().startsWith("v=spf1")) continue;
      const mode = parseSpfMode(joined);
      const pass = /\b(include|a|mx|ip4:|ip6:|ptr|exists:|redirect=)/i.test(joined);
      return {
        pass,
        reason: pass ? null : "SPF record found but no permissive mechanism",
        record: joined,
        mode,
      };
    }
    return { pass: false, reason: "No SPF record found", record: null, mode: null };
  } catch (err) {
    return {
      pass: false,
      reason: err instanceof Error ? err.message : "SPF lookup failed",
      record: null,
      mode: null,
    };
  }
}

function parseSpfMode(record: string): SpfMode {
  if (/\s-all\b/i.test(record)) return "strict";
  if (/\s~all\b/i.test(record)) return "softfail";
  if (/\s\?all\b/i.test(record)) return "neutral";
  return null;
}

async function checkDkim(domain: string): Promise<DomainAuthResult["dkim"]> {
  const selectorsFound: string[] = [];
  for (const selector of DKIM_SELECTORS) {
    const host = `${selector}._domainkey.${domain}`;
    try {
      const records = await dns.resolveTxt(host);
      for (const chunks of records) {
        const joined = chunks.join("");
        selectorsFound.push(selector);
        if (/v=DKIM1/i.test(joined)) {
          const keyMatch = joined.match(/(?:^|;)\s*p=([^;\s]+)/i);
          if (keyMatch?.[1]) {
            return {
              pass: true,
              reason: null,
              record: joined,
              selectors_found: selectorsFound,
            };
          }
        }
      }
      if (records.length > 0) {
        return {
          pass: false,
          reason: `DKIM TXT at ${selector} missing v=DKIM1 public key`,
          record: records.map((c) => c.join("")).join(" "),
          selectors_found: selectorsFound,
        };
      }
    } catch {
      // try next selector
    }
  }
  return {
    pass: false,
    reason: "No DKIM TXT record found for common selectors",
    record: null,
    selectors_found: selectorsFound,
  };
}

async function checkDmarc(domain: string): Promise<DomainAuthResult["dmarc"]> {
  const host = `_dmarc.${domain}`;
  try {
    const records = await dns.resolveTxt(host);
    for (const chunks of records) {
      const joined = chunks.join("");
      if (!joined.toLowerCase().startsWith("v=dmarc1")) continue;
      const policy = parseDmarcPolicy(joined);
      return {
        pass: true,
        reason: policy === null ? "DMARC record found but no p= policy" : null,
        record: joined,
        policy,
      };
    }
    return { pass: false, reason: "No DMARC record found", record: null, policy: null };
  } catch (err) {
    return {
      pass: false,
      reason: err instanceof Error ? err.message : "DMARC lookup failed",
      record: null,
      policy: null,
    };
  }
}

function parseDmarcPolicy(record: string): DomainAuthResult["dmarc"]["policy"] {
  const match = record.match(/;\s*p=([^;\s]+)/i) ?? record.match(/^v=DMARC1;\s*p=([^;\s]+)/i);
  if (!match?.[1]) return null;
  const raw = match[1].toLowerCase();
  if (raw === "none" || raw === "quarantine" || raw === "reject") return raw;
  return null;
}
