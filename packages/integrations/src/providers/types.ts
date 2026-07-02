/**
 * Per-CRM provider config the rest of the app talks to instead of hard-coding
 * `"salesforce"` / `"hubspot"` strings and endpoint paths.
 */

export type CrmProvider = "salesforce" | "hubspot";

export interface CrmProviderConfig {
  readonly provider: CrmProvider;
  /** Human label for the connect UI. */
  readonly displayName: string;
  /** Nango integration id — matches whatever's configured in the Nango dashboard. */
  readonly nangoIntegrationId: string;
  /** Sync model names Nango exposes for contacts and accounts. */
  readonly syncModels: {
    readonly contact: string;
    readonly account: string;
  };
  /** Default Quiksend-side field mapping for a fresh connection. Editable per workspace. */
  readonly defaultFieldMapping: FieldMapping;
}

export interface FieldMapping {
  /** Maps Quiksend prospect fields → CRM field names. */
  readonly prospect: Readonly<Record<ProspectField, string>>;
  /** Maps Quiksend company fields → CRM field names. */
  readonly company: Readonly<Record<CompanyField, string>>;
}

export type ProspectField = "email" | "firstName" | "lastName" | "title" | "linkedinUrl" | "phone";
export type CompanyField = "name" | "domain" | "industry" | "size" | "website";
