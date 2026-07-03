import { env } from "@quiksend/config";

/** HTML + plain parts before MIME assembly or adapter.send. */
export interface BuiltMime {
  readonly html: string;
  readonly text: string;
}

export interface SanitizeForSegOptions {
  readonly stripTrackingPixel: boolean;
  readonly stripExternalImages: boolean;
  readonly preferPlainText: boolean;
  /** Override tracking host detection (tests). */
  readonly trackingDomain?: string;
}

const MAX_INLINE_IMAGE_BYTES = 100 * 1024;

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trackingHost(): string {
  if (env.TRACKING_PIXEL_DOMAIN) return env.TRACKING_PIXEL_DOMAIN.toLowerCase();
  const base = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return "localhost";
  }
}

function stripTrackingPixels(html: string, domain: string): string {
  const hostPattern = domain.replace(/\./g, "\\.");
  const re = new RegExp(
    `<img\\b[^>]*\\bsrc\\s*=\\s*["'][^"']*${hostPattern}[^"']*["'][^>]*\\/?>`,
    "gi",
  );
  return html.replace(re, "");
}

function isExternalImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("cid:")) return false;
  if (trimmed.startsWith("//")) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return false;
}

function shouldPreferPlainText(text: string, html: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const strippedHtmlLen = stripHtmlTags(html).length;
  if (strippedHtmlLen === 0) return true;
  return trimmed.length >= strippedHtmlLen * 0.5;
}

/** Sync HTML sanitizer for SEG-destined sends. */
export function sanitizeForSeg(mime: BuiltMime, options: SanitizeForSegOptions): BuiltMime {
  let html = mime.html;
  let text = mime.text;

  if (options.stripTrackingPixel) {
    html = stripTrackingPixels(html, options.trackingDomain ?? trackingHost());
  }

  if (options.stripExternalImages) {
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
    html = html.replace(imgRe, (tag, src: string) => {
      if (src.startsWith("data:")) {
        return Buffer.byteLength(src, "utf8") <= MAX_INLINE_IMAGE_BYTES ? tag : "";
      }
      if (!isExternalImageSrc(src)) return tag;
      return "";
    });
  }

  if (options.preferPlainText && shouldPreferPlainText(text, html)) {
    return { html: "", text };
  }

  return { html, text };
}

export function extractRecipientDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return email.toLowerCase();
  return email.slice(at + 1).toLowerCase();
}
