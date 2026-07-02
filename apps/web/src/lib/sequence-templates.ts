export const KNOWN_TOKENS = [
  "first_name",
  "last_name",
  "email",
  "title",
  "company_name",
  "company_domain",
  "sender_first_name",
  "sender_signature",
] as const;

export type KnownToken = (typeof KNOWN_TOKENS)[number];

const TOKEN_PATTERN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export function extractTokens(str: string): readonly string[] {
  const found = new Set<string>();
  for (const match of str.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (token) found.add(token);
  }
  return [...found];
}

export function validateTemplate(str: string): { valid: boolean; unknown: string[] } {
  const tokens = extractTokens(str);
  const known = new Set<string>(KNOWN_TOKENS);
  const unknown = tokens.filter((t) => !known.has(t));
  return { valid: unknown.length === 0, unknown };
}

export type TemplateSample = Partial<Record<KnownToken, string>>;

const DEFAULT_SAMPLE: TemplateSample = {
  first_name: "Alex",
  last_name: "Rivera",
  email: "alex@acme.com",
  title: "VP Sales",
  company_name: "Acme Corp",
  company_domain: "acme.com",
  sender_first_name: "Jordan",
  sender_signature: "Jordan Smith\nAccount Executive",
};

export function renderPreview(str: string, sample: TemplateSample = DEFAULT_SAMPLE): string {
  return str.replace(TOKEN_PATTERN, (_match, token: string) => sample[token as KnownToken] ?? "");
}
