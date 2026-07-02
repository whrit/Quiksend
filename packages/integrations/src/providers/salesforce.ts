import type { CrmProviderConfig } from "./types.ts";

/**
 * Salesforce provider config. Field names are the standard SOQL API names on
 * `Contact` and `Account` — orgs with custom fields override the mapping in the
 * connect settings UI (Phase 3 R-033).
 */
export const salesforceConfig: CrmProviderConfig = {
  provider: "salesforce",
  displayName: "Salesforce",
  nangoIntegrationId: "salesforce",
  syncModels: { contact: "Contact", account: "Account" },
  defaultFieldMapping: {
    prospect: {
      email: "Email",
      firstName: "FirstName",
      lastName: "LastName",
      title: "Title",
      linkedinUrl: "LinkedIn_URL__c",
      phone: "Phone",
    },
    company: {
      name: "Name",
      domain: "Website",
      industry: "Industry",
      size: "NumberOfEmployees",
      website: "Website",
    },
  },
};
