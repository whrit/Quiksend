import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  mainText: string;
  extractedAt: string;
}

const USER_AGENT = "Quiksend-Research-Bot/1.0 (+https://quiksend.dev)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".test", ".localhost"] as const;

const BLOCKED_IPV4_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
] as const;

const CLOUD_METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function stripTags(html: string, tagNames: readonly string[]): string {
  let out = html;
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
  }
  return out;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToText(html: string): string {
  const withoutScripts = stripTags(html, ["script", "style", "nav", "footer", "header"]);
  const mainMatch =
    withoutScripts.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    withoutScripts.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ??
    withoutScripts.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const chunk = mainMatch?.[1] ?? withoutScripts;
  const text = decodeHtmlEntities(chunk.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()) || null;
}

function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }
  return lower;
}

function isBlockedIpv4(host: string): boolean {
  if (CLOUD_METADATA_HOSTS.has(host)) return true;
  return BLOCKED_IPV4_PATTERNS.some((pattern) => pattern.test(host));
}

function isBlockedIpv6(address: string): boolean {
  const normalized = normalizeHost(address);
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  return false;
}

function isBlockedLiteralHost(host: string): boolean {
  const lower = normalizeHost(host);
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  if (isBlockedIpv4(lower)) return true;
  if (isBlockedIpv6(lower)) return true;
  return false;
}

function isBlockedResolvedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

async function validateFetchUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid fetch URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Fetch URL must use HTTP or HTTPS");
  }

  const host = normalizeHost(parsed.hostname);
  if (isBlockedLiteralHost(host)) {
    throw new Error("Fetch URL resolves to a blocked host");
  }

  if (isIP(host)) return;

  const results = await lookup(host, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error("Fetch URL hostname did not resolve");
  }

  for (const { address } of results) {
    if (isBlockedResolvedAddress(address)) {
      throw new Error("Fetch URL resolves to a private or metadata address");
    }
  }
}

async function fetchWithSsrfProtection(url: string, init: RequestInit): Promise<Response> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await validateFetchUrl(currentUrl);
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    currentUrl = new URL(location, currentUrl).href;
  }

  throw new Error("Fetch exceeded redirect limit");
}

async function readResponseTextCapped(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new Error(`Response exceeds maximum size of ${maxBytes} bytes`);
    }
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Response exceeds maximum size of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder();
  if (chunks.length === 1) {
    return decoder.decode(chunks[0]);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(merged);
}

export function extractMainTextFromHtml(html: string): { title: string | null; mainText: string } {
  return {
    title: extractTitle(html),
    mainText: htmlToText(html),
  };
}

export async function fetchAndExtract(url: string): Promise<FetchedPage> {
  const response = await fetchWithSsrfProtection(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await readResponseTextCapped(response, MAX_RESPONSE_BYTES);
  const { title, mainText } = extractMainTextFromHtml(html);

  return {
    url,
    finalUrl: response.url,
    title,
    mainText,
    extractedAt: new Date().toISOString(),
  };
}
