import { logger } from "@quiksend/config";

/** Well-known public IMAP hosts always permitted. */
export const SAFE_IMAP_HOSTS = new Set([
  "imap.gmail.com",
  "outlook.office365.com",
  "imap.mail.me.com",
  "imap.mail.yahoo.com",
]);

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".test", ".localhost"] as const;

const RFC1918_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
] as const;

const CLOUD_METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isBlockedIp(host: string): boolean {
  if (CLOUD_METADATA_HOSTS.has(host)) return true;
  return RFC1918_PATTERNS.some((pattern) => pattern.test(host));
}

function isBlockedHostname(host: string): boolean {
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function isValidPublicFqdn(host: string): boolean {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    return false;
  }
  return host.includes(".");
}

/**
 * Validates an IMAP hostname for user-provided seed inboxes (SSRF protection).
 * Returns an error message when rejected, or null when allowed.
 */
export function validateImapHost(host: string): string | null {
  const trimmed = host.trim();
  if (!trimmed) return "IMAP host is required";

  const normalized = trimmed.toLowerCase();

  if (SAFE_IMAP_HOSTS.has(normalized)) return null;

  if (isIpv4(normalized)) {
    if (isBlockedIp(normalized)) {
      logger.warn({ imapHost: host }, "security: rejected private/metadata IMAP host");
      return "IMAP host must be a public mail server, not a private or metadata IP address";
    }
    logger.warn({ imapHost: host }, "security: rejected bare IP IMAP host");
    return "IMAP host must be a public mail server hostname, not a bare IP address";
  }

  if (isBlockedHostname(normalized) || isBlockedIp(normalized)) {
    logger.warn({ imapHost: host }, "security: rejected blocked IMAP hostname");
    return "IMAP host is not allowed for security reasons";
  }

  if (!isValidPublicFqdn(normalized)) {
    return "IMAP host must be a valid public hostname";
  }

  return null;
}
