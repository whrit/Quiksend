/**
 * `@quiksend/integrations` — Nango wrapper + CRM provider config.
 *
 * The rest of the app never imports `@nangohq/node` directly; it goes through
 * this package so provider-specific config (integration ids, sync/model names,
 * default field mappings for Salesforce + HubSpot) lives in one place.
 */
export * from "./nango.ts";
export * from "./webhook.ts";
export * from "./providers/index.ts";
export * from "./sync/index.ts";
export * from "./writeback/index.ts";
