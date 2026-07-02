const TOKEN_PATTERN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export interface TemplateContext {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string;
  readonly title: string | null;
  readonly companyName: string | null;
  readonly companyDomain: string | null;
  readonly senderFirstName: string | null;
  readonly senderSignature: string | null;
}

export function renderTemplate(str: string, ctx: TemplateContext): string {
  const map: Record<string, string> = {
    first_name: ctx.firstName ?? "",
    last_name: ctx.lastName ?? "",
    email: ctx.email,
    title: ctx.title ?? "",
    company_name: ctx.companyName ?? "",
    company_domain: ctx.companyDomain ?? "",
    sender_first_name: ctx.senderFirstName ?? "",
    sender_signature: ctx.senderSignature ?? "",
  };
  return str.replace(TOKEN_PATTERN, (_match, token: string) => map[token] ?? "");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
