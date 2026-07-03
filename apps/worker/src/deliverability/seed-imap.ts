import { ImapFlow } from "imapflow";
import type { SeedImapConfigPlain } from "@quiksend/mail";

export interface ImapMessageMatch {
  readonly uid: number;
  readonly folder: string;
  readonly raw: string;
  readonly headers: Record<string, string>;
}

const FOLDER_CANDIDATES = [
  "INBOX",
  "Inbox",
  "Spam",
  "Junk",
  "Junk E-mail",
  "Bulk Mail",
  "Quarantine",
  "[Gmail]/Spam",
] as const;

export async function verifyImapConnection(config: SeedImapConfigPlain): Promise<void> {
  const client = createImapClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function searchCanaryMessages(
  config: SeedImapConfigPlain,
  canaryTokens: readonly string[],
  since: Date,
): Promise<Map<string, ImapMessageMatch>> {
  if (process.env.QUIKSEND_CANARY_IMAP_MOCK === "not_found") {
    return new Map();
  }

  if (process.env.QUIKSEND_CANARY_IMAP_MOCK === "inbox") {
    const results = new Map<string, ImapMessageMatch>();
    for (const token of canaryTokens) {
      results.set(token, {
        uid: 1,
        folder: "INBOX",
        raw: mockCanaryMime(token),
        headers: {
          "X-Quiksend-Canary-Id": token,
          "Authentication-Results": "mx.example.com; spf=pass",
          Received: "from mx.example.com by seed.inbox",
        },
      });
    }
    return results;
  }

  const tokenSet = new Set(canaryTokens);
  const found = new Map<string, ImapMessageMatch>();
  const client = createImapClient(config);

  try {
    await client.connect();
    for (const folder of FOLDER_CANDIDATES) {
      if (found.size === tokenSet.size) break;
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const uids = await client.search({ since }, { uid: true });
          const uidList = uids === false ? [] : uids;
          for (const uid of uidList) {
            const msg = await client.fetchOne(
              String(uid),
              { source: true, uid: true },
              { uid: true },
            );
            if (!msg || !msg.source) continue;
            const raw = msg.source.toString("utf8");
            const token = extractCanaryToken(raw);
            if (!token || !tokenSet.has(token) || found.has(token)) continue;
            found.set(token, {
              uid,
              folder,
              raw,
              headers: extractForensicHeaders(raw),
            });
          }
        } finally {
          lock.release();
        }
      } catch {
        // Folder may not exist on this provider — skip.
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return found;
}

function createImapClient(config: SeedImapConfigPlain): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
    logger: false,
  });
}

function extractCanaryToken(raw: string): string | null {
  const match = raw.match(/^X-Quiksend-Canary-Id:\s*(.+)$/im);
  return match?.[1]?.trim() ?? null;
}

function extractForensicHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  let currentKey: string | null = null;
  for (const line of lines) {
    if (line === "") break;
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.toLowerCase() === "authentication-results" || key.toLowerCase() === "received") {
      headers[key] = headers[key] ? `${headers[key]}\n${value}` : value;
      currentKey = key;
    }
  }
  return headers;
}

function mockCanaryMime(token: string): string {
  return [
    `X-Quiksend-Canary-Id: ${token}`,
    "Authentication-Results: mx.example.com; spf=pass",
    "Received: from mx.example.com by seed.inbox",
    "Subject: Canary test",
    "",
    "body",
  ].join("\r\n");
}

export function classifyArrivalFolder(
  folder: string,
): "inbox" | "spam" | "quarantine" | "not_found" {
  const lower = folder.toLowerCase();
  if (lower.includes("spam") || lower.includes("junk") || lower.includes("bulk")) {
    return "spam";
  }
  if (lower.includes("quarantine")) {
    return "quarantine";
  }
  if (lower.includes("inbox")) {
    return "inbox";
  }
  return "inbox";
}
