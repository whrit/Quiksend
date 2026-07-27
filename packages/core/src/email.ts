/**
 * Email address helpers. Pure string work — no I/O, no DB.
 *
 * Lives here because domain extraction is the matching key for domain-level
 * suppression, SEG routing, and per-domain send gaps. It was previously copied
 * verbatim into four modules across both apps.
 */

/**
 * Lowercased domain part of an address, for domain-level matching.
 *
 * Uses the LAST `@` because quoted local parts may legally contain one
 * (`"a@b"@example.com` → `example.com`). Returns the whole lowercased input
 * when there is no `@`, so callers comparing against a domain list simply get
 * no match rather than an exception.
 */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}
