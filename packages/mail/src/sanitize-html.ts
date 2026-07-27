import { sanitize as sanitizeHtmlWithDomPurify } from "isomorphic-dompurify";

/**
 * Isomorphic XSS sanitizer for inbound / user-authored HTML.
 *
 * Deliberately isolated in its own module with NO `@quiksend/config` import.
 * The inbox renders inbound mail in the browser, so this runs client-side; the
 * `@quiksend/mail` barrel pulls in modules that read `env` (which needs
 * `DATABASE_URL`), and evaluating those in a browser throws
 * "Invalid environment variables". Import this file directly — via
 * `@quiksend/mail/sanitize-html` — from anything client-reachable.
 */

const INBOUND_HTML_PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "base", "link", "meta"],
};

/** Strip XSS vectors from inbound or user-authored HTML before storage or render. */
export function sanitizeInboundHtml(html: string): string {
  if (!html.trim()) return "";
  return sanitizeHtmlWithDomPurify(html, INBOUND_HTML_PURIFY_CONFIG);
}
