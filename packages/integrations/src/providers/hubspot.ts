import type { CrmProviderConfig } from "./types.ts";

/**
 * HubSpot provider config. Field names are the standard property names on the
 * HubSpot Contact + Company objects.
 */
export const hubspotConfig: CrmProviderConfig = {
  provider: "hubspot",
  displayName: "HubSpot",
  nangoIntegrationId: "hubspot",
  syncModels: { contact: "Contact", account: "Company" },
  defaultFieldMapping: {
    prospect: {
      email: "email",
      firstName: "firstname",
      lastName: "lastname",
      title: "jobtitle",
      linkedinUrl: "linkedin_url",
      phone: "phone",
    },
    company: {
      name: "name",
      domain: "domain",
      industry: "industry",
      size: "numberofemployees",
      website: "website",
    },
  },
};
