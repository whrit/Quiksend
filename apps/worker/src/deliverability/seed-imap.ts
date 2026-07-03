import { ImapFlow } from "imapflow";
import type { SeedImapConfigPlain } from "@quiksend/mail";

type ImapSearchQuery = {
  since?: Date;
  header?: Record<string, string>;
  subject?: string;
};

type ImapFetchMessage = {
  uid?: number;
  headers?: Map<string, string | string[]> | Record<string, string | string[]>;
  source?: Buffer;
};

type ImapFetchQuery = {
  uid?: boolean;
  envelope?: boolean;
  bodyStructure?: boolean;
  headers?: readonly string[];
  source?: boolean;
};

export interface ImapMessageMatch {
  readonly uid: number;
  readonly folder: string;
  readonly raw: string;
  readonly headers: Record<string, string>;
  readonly isBounce?: boolean;
}

export type ArrivalFolder = "inbox" | "spam" | "quarantine" | "not_found";

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

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

const FETCH_HEADERS = [
  "X-Quiksend-Canary-Id",
  "In-Reply-To",
  "References",
  "Auto-Submitted",
  "Return-Path",
  "Content-Type",
  "Subject",
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
  const mockMode = process.env.QUIKSEND_CANARY_IMAP_MOCK;
  if (mockMode === "not_found") {
    return new Map();
  }

  if (
    mockMode === "inbox" ||
    mockMode === "spam" ||
    mockMode === "quarantine" ||
    mockMode === "bounce"
  ) {
    return buildMockMatches(canaryTokens, mockMode);
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
          for (const token of canaryTokens) {
            if (found.has(token)) continue;
            const match = await findTokenInFolder(client, folder, token, since, tokenSet);
            if (match) {
              found.set(token, match);
            }
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

async function findTokenInFolder(
  client: ImapFlow,
  folder: string,
  token: string,
  since: Date,
  tokenSet: ReadonlySet<string>,
): Promise<ImapMessageMatch | null> {
  const shortToken = token.replace(/-/g, "").slice(0, 8);
  let uids = await client.search(
    { header: { "X-Quiksend-Canary-Id": token }, since } as ImapSearchQuery,
    { uid: true },
  );
  if (!uids || uids.length === 0) {
    uids = await client.search({ subject: `[Q${shortToken}]`, since } as ImapSearchQuery, {
      uid: true,
    });
  }
  const uidList = uids === false ? [] : uids;
  if (uidList.length === 0) return null;

  for (const uid of uidList) {
    const msg = (await client.fetchOne(
      String(uid),
      {
        uid: true,
        envelope: true,
        bodyStructure: false,
        headers: [...FETCH_HEADERS],
      } as ImapFetchQuery,
      { uid: true },
    )) as ImapFetchMessage | false;
    if (!msg) continue;

    const headers = normalizeFetchedHeaders(msg.headers);
    let tokenFromHeaders = extractCanaryTokenFromHeaders(headers, tokenSet);
    let raw = "";
    let isBounce = isBounceMessage(headers);

    if (!tokenFromHeaders || isBounce) {
      const bodyMsg = (await client.fetchOne(String(uid), { source: true } as ImapFetchQuery, {
        uid: true,
      })) as ImapFetchMessage | false;
      if (bodyMsg && bodyMsg.source) {
        raw = bodyMsg.source.toString("utf8");
        tokenFromHeaders = extractCanaryToken(raw, tokenSet) ?? tokenFromHeaders;
        isBounce = isBounce || isBounceMessage(headers, raw);
      }
    }

    if (tokenFromHeaders !== token) continue;

    return {
      uid,
      folder,
      raw: raw || headersToRaw(headers),
      headers,
      isBounce,
    };
  }

  return null;
}

function normalizeFetchedHeaders(
  headers: Map<string, string | string[]> | Record<string, string | string[]> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  const entries = headers instanceof Map ? [...headers.entries()] : Object.entries(headers);
  for (const [key, value] of entries) {
    out[key] = Array.isArray(value) ? value.join(" ") : value;
  }
  return out;
}

function headersToRaw(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n");
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

export function extractCanaryToken(raw: string, knownTokens?: ReadonlySet<string>): string | null {
  const headerMatch = raw.match(/^X-Quiksend-Canary-Id:\s*(.+)$/im);
  if (headerMatch?.[1]) {
    const candidate = headerMatch[1].trim();
    if (!knownTokens || knownTokens.has(candidate)) return candidate;
  }

  for (const line of raw.split(/\r?\n/)) {
    if (/^(in-reply-to|references):/i.test(line)) {
      const token = findKnownTokenInText(line, knownTokens);
      if (token) return token;
    }
  }

  return findKnownTokenInText(raw, knownTokens);
}

function extractCanaryTokenFromHeaders(
  headers: Record<string, string>,
  knownTokens?: ReadonlySet<string>,
): string | null {
  const direct =
    headers["X-Quiksend-Canary-Id"] ??
    headers["x-quiksend-canary-id"] ??
    headers["X-QUIKSEND-CANARY-ID"];
  if (direct) {
    const trimmed = direct.trim();
    if (!knownTokens || knownTokens.has(trimmed)) return trimmed;
  }

  for (const key of ["In-Reply-To", "References", "in-reply-to", "references"]) {
    const value = headers[key];
    if (!value) continue;
    const token = findKnownTokenInText(value, knownTokens);
    if (token) return token;
  }

  return null;
}

function findKnownTokenInText(text: string, knownTokens?: ReadonlySet<string>): string | null {
  if (knownTokens) {
    for (const token of knownTokens) {
      if (text.includes(token)) return token;
    }
    return null;
  }

  const match = text.match(UUID_RE);
  return match?.[0] ?? null;
}

export function isBounceMessage(headers: Record<string, string>, raw?: string): boolean {
  const contentType = (headers["Content-Type"] ?? headers["content-type"] ?? "").toLowerCase();
  const autoSubmitted = (
    headers["Auto-Submitted"] ??
    headers["auto-submitted"] ??
    ""
  ).toLowerCase();
  const returnPath = headers["Return-Path"] ?? headers["return-path"] ?? "";

  if (contentType.includes("multipart/report")) return true;
  if (autoSubmitted.includes("auto-replied") || autoSubmitted === "auto-generated") {
    return true;
  }
  if (returnPath === "<>" || returnPath.includes("<>")) return true;

  if (!raw) return false;
  const lower = raw.toLowerCase();
  return (
    lower.includes("content-type: multipart/report") ||
    lower.includes("auto-submitted: auto-replied") ||
    lower.includes("return-path: <>")
  );
}

export function classifyArrivalFolder(folder: string): ArrivalFolder {
  const lower = folder.toLowerCase();
  if (lower.includes("spam") || lower.includes("junk") || lower.includes("bulk")) {
    return "spam";
  }
  if (lower.includes("quarantine") || lower.includes("clutter")) {
    return "quarantine";
  }
  if (lower.includes("inbox") || lower === "other") {
    return "inbox";
  }
  return "not_found";
}

export type CanaryArrivalStatus =
  | "arrived_inbox"
  | "arrived_spam"
  | "arrived_quarantine"
  | "bounced";

export function folderToStatus(
  folder: ArrivalFolder,
  options?: { isBounce?: boolean },
): CanaryArrivalStatus {
  if (options?.isBounce) return "bounced";
  switch (folder) {
    case "spam":
      return "arrived_spam";
    case "quarantine":
      return "arrived_quarantine";
    case "inbox":
      return "arrived_inbox";
    default:
      return "arrived_inbox";
  }
}

function buildMockMatches(
  canaryTokens: readonly string[],
  mode: "inbox" | "spam" | "quarantine" | "bounce",
): Map<string, ImapMessageMatch> {
  const results = new Map<string, ImapMessageMatch>();
  const folderByMode = {
    inbox: "INBOX",
    spam: "Spam",
    quarantine: "Quarantine",
    bounce: "INBOX",
  } as const;

  for (const token of canaryTokens) {
    const isBounce = mode === "bounce";
    const raw = isBounce ? mockBounceMime(token) : mockCanaryMime(token);
    results.set(token, {
      uid: 1,
      folder: folderByMode[mode],
      raw,
      headers: extractForensicHeaders(raw),
      isBounce,
    });
  }
  return results;
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
    headers[key] = headers[key] ? `${headers[key]}\n${value}` : value;
    if (key.toLowerCase() === "authentication-results" || key.toLowerCase() === "received") {
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

function mockBounceMime(token: string): string {
  return [
    `In-Reply-To: <${token}@quiksend.local>`,
    "Content-Type: multipart/report; report-type=delivery-status",
    "Auto-Submitted: auto-replied",
    "Return-Path: <>",
    "Subject: Undelivered Mail Returned to Sender",
    "",
    `Delivery failed for canary ${token}`,
  ].join("\r\n");
}
