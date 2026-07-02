import { hubspotConfig } from "./hubspot.ts";
import { salesforceConfig } from "./salesforce.ts";
import type { CrmProvider, CrmProviderConfig } from "./types.ts";

export const CRM_PROVIDERS: Readonly<Record<CrmProvider, CrmProviderConfig>> = {
  salesforce: salesforceConfig,
  hubspot: hubspotConfig,
};

export function getProviderConfig(provider: CrmProvider): CrmProviderConfig {
  const cfg = CRM_PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown CRM provider: ${String(provider)}`);
  return cfg;
}
