import * as dns from "node:dns/promises";

export interface DomainAuthResult {
  readonly spf: { pass: boolean; reason: string | null; record: string | null };
  readonly dkim: { pass: boolean; reason: string | null };
  readonly dmarc: { pass: boolean; reason: string | null; record: string | null };
}

const DKIM_SELECTORS = ["default", "google", "k1", "s1"] as const;

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
      const pass = /\b(include|a|mx|ip4:|ip6:|ptr|exists:|redirect=)/i.test(joined);
      return {
        pass,
        reason: pass ? null : "SPF record found but no permissive mechanism",
        record: joined,
      };
    }
    return { pass: false, reason: "No SPF record found", record: null };
  } catch (err) {
    return {
      pass: false,
      reason: err instanceof Error ? err.message : "SPF lookup failed",
      record: null,
    };
  }
}

async function checkDkim(domain: string): Promise<DomainAuthResult["dkim"]> {
  for (const selector of DKIM_SELECTORS) {
    const host = `${selector}._domainkey.${domain}`;
    try {
      const records = await dns.resolveTxt(host);
      if (records.length > 0) {
        return { pass: true, reason: null };
      }
    } catch {
      // try next selector
    }
  }
  return {
    pass: false,
    reason: "No DKIM TXT record found for common selectors (full key validation deferred)",
  };
}

async function checkDmarc(domain: string): Promise<DomainAuthResult["dmarc"]> {
  const host = `_dmarc.${domain}`;
  try {
    const records = await dns.resolveTxt(host);
    for (const chunks of records) {
      const joined = chunks.join("");
      if (joined.toLowerCase().startsWith("v=dmarc1")) {
        return { pass: true, reason: null, record: joined };
      }
    }
    return { pass: false, reason: "No DMARC record found", record: null };
  } catch (err) {
    return {
      pass: false,
      reason: err instanceof Error ? err.message : "DMARC lookup failed",
      record: null,
    };
  }
}
