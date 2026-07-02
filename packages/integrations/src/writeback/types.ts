import type { Nango } from "@nangohq/node";

export type SalesforceTaskInput = {
  subject: string;
  description: string;
  activityDate: string;
};

export type SalesforceContactInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  phone?: string | null;
};

export type SalesforceStatusInput = {
  field: string;
  value: string;
};

export type HubspotEngagementInput = {
  subject: string;
  body: string;
  timestamp: string;
};

export type HubspotContactInput = SalesforceContactInput;

export type HubspotStatusInput = SalesforceStatusInput;

export type WritebackResult = {
  externalId: string;
  response: unknown;
};

export type NangoProxy = Pick<Nango, "post" | "patch">;
