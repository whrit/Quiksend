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

async function fetchInlineBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_INLINE_IMAGE_BYTES) return null;
    const contentType = response.headers.get("content-type") ?? "image/png";
    return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function stripOrInlineExternalImages(html: string): Promise<string> {
  const imgRe = /<img\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  const matches = [...html.matchAll(imgRe)];
  if (matches.length === 0) return html;

  let result = html;
  for (const match of matches) {
    const full = match[0];
    const src = match[2] ?? "";
    if (!isExternalImageSrc(src)) continue;

    const inlined = await fetchInlineBase64(src.startsWith("//") ? `https:${src}` : src);
    if (inlined) {
      const replaced = full.replace(src, inlined);
      result = result.replace(full, replaced);
    } else {
      result = result.replace(full, "");
    }
  }
  return result;
}

/** Conservative HTML sanitizer for SEG-destined sends. */
export async function sanitizeForSegAsync(
  mime: BuiltMime,
  options: SanitizeForSegOptions,
): Promise<BuiltMime> {
  let html = mime.html;
  let text = mime.text;

  if (options.stripTrackingPixel) {
    html = stripTrackingPixels(html, options.trackingDomain ?? trackingHost());
  }

  if (options.stripExternalImages) {
    html = await stripOrInlineExternalImages(html);
  }

  if (options.preferPlainText && text.trim().length > 0) {
    return { html: "", text };
  }

  return { html, text };
}

/** Sync variant — skips network inlining (strips external images instead). */
export function sanitizeForSeg(mime: BuiltMime, options: SanitizeForSegOptions): BuiltMime {
  let html = mime.html;
  let text = mime.text;

  if (options.stripTrackingPixel) {
    html = stripTrackingPixels(html, options.trackingDomain ?? trackingHost());
  }

  if (options.stripExternalImages) {
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
    html = html.replace(imgRe, (tag, src: string) => {
      if (!isExternalImageSrc(src)) return tag;
      if (src.startsWith("data:") && Buffer.byteLength(src, "utf8") <= MAX_INLINE_IMAGE_BYTES) {
        return tag;
      }
      return "";
    });
  }

  if (options.preferPlainText && text.trim().length > 0) {
    return { html: "", text };
  }

  return { html, text };
}

export function extractRecipientDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return email.toLowerCase();
  return email.slice(at + 1).toLowerCase();
}
