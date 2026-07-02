import type {
  NangoProxy,
  SalesforceContactInput,
  SalesforceStatusInput,
  SalesforceTaskInput,
  WritebackResult,
} from "./types.ts";

const SF_API = "/services/data/v58.0";

function readId(data: unknown): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.id === "string") return record.id;
    if (typeof record.Id === "string") return record.Id;
  }
  throw new Error("Salesforce response missing record id");
}

export async function logSalesforceTask(
  nango: NangoProxy,
  nangoConnectionId: string,
  contactId: string | null,
  input: SalesforceTaskInput,
): Promise<WritebackResult> {
  const res = await nango.post({
    endpoint: `${SF_API}/sobjects/Task`,
    providerConfigKey: "salesforce",
    connectionId: nangoConnectionId,
    data: {
      Subject: input.subject,
      Description: input.description,
      ActivityDate: input.activityDate,
      Status: "Completed",
      ...(contactId ? { WhoId: contactId } : {}),
    },
    retries: 3,
    retryOn: [429, 500, 502, 503, 504],
  });

  return { externalId: readId(res.data), response: res.data };
}

export async function upsertSalesforceContact(
  nango: NangoProxy,
  nangoConnectionId: string,
  input: SalesforceContactInput,
): Promise<WritebackResult> {
  const email = encodeURIComponent(input.email);
  const body: Record<string, string> = { Email: input.email };
  if (input.firstName) body.FirstName = input.firstName;
  if (input.lastName) body.LastName = input.lastName;
  if (input.title) body.Title = input.title;
  if (input.phone) body.Phone = input.phone;

  const res = await nango.patch({
    endpoint: `${SF_API}/sobjects/Contact/Email/${email}`,
    providerConfigKey: "salesforce",
    connectionId: nangoConnectionId,
    data: body,
    retries: 3,
    retryOn: [429, 500, 502, 503, 504],
  });

  return { externalId: readId(res.data), response: res.data };
}

export async function updateSalesforceStatus(
  nango: NangoProxy,
  nangoConnectionId: string,
  contactId: string,
  input: SalesforceStatusInput,
): Promise<WritebackResult> {
  const res = await nango.patch({
    endpoint: `${SF_API}/sobjects/Contact/${contactId}`,
    providerConfigKey: "salesforce",
    connectionId: nangoConnectionId,
    data: { [input.field]: input.value },
    retries: 3,
    retryOn: [429, 500, 502, 503, 504],
  });

  return { externalId: contactId, response: res.data };
}
