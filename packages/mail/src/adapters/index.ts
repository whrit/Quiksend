/**
 * Provider adapters land in Phase 4:
 *   • ./smtp.ts       — nodemailer + Mailpit (first, since it works locally).
 *   • ./gmail.ts      — Gmail API via Nango-managed OAuth.
 *   • ./microsoft.ts  — Microsoft Graph via Nango-managed OAuth.
 *
 * ./fake.ts already ships; tests import it directly.
 */
export { createFakeAdapter } from "./fake.ts";
export { createSmtpAdapter, createSmtpTransport, sendMime } from "./smtp.ts";
