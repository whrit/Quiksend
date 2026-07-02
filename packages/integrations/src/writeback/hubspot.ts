import type {
  HubspotContactInput,
  HubspotEngagementInput,
  HubspotStatusInput,
  NangoProxy,
  WritebackResult,
} from "./types.ts";

function readId(data: unknown): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.id === "string") return record.id;
  }
  throw new Error("HubSpot response missing record id");
}

export async function logHubspotEngagement(
  nango: NangoProxy,
  nangoConnectionId: string,
  contactId: string | null,
  input: HubspotEngagementInput,
): Promise<WritebackResult> {
  const res = await nango.post({
    endpoint: "/crm/v3/objects/notes",
    providerConfigKey: "hubspot",
    connectionId: nangoConnectionId,
    data: {
      properties: {
        hs_timestamp: input.timestamp,
        hs_note_body: `${input.subject}\n\n${input.body}`,
      },
      ...(contactId
        ? {
            associations: [
              {
                to: { id: contactId },
                types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
              },
            ],
          }
        : {}),
    },
    retries: 3,
    retryOn: [429, 500, 502, 503, 504],
  });

  return { externalId: readId(res.data), response: res.data };
}

export async function upsertHubspotContact(
  nango: NangoProxy,
  nangoConnectionId: string,
  input: HubspotContactInput,
): Promise<WritebackResult> {
  const res = await nango.post({
    endpoint: "/crm/v3/objects/contacts/batch/upsert",
    providerConfigKey: "hubspot",
    connectionId: nangoConnectionId,
    data: {
      inputs: [
        {
          idProperty: "email",
          id: input.email,
          properties: {
            email: input.email,
            ...(input.firstName ? { firstname: input.firstName } : {}),
            ...(input.lastName ? { lastname: input.lastName } : {}),
            ...(input.title ? { jobtitle: input.title } : {}),
            ...(input.phone ? { phone: input.phone } : {}),
          },
        },
      ],
    },
    retries: 3,
    retryOn: [429, 500, 502, 503, 504],
  });

  const results = (res.data as { results?: { id: string }[] })?.results;
  const id = results?.[0]?.id;
  if (!id) throw new Error("HubSpot contact upsert missing id");
  return { externalId: id, response: res.data };
}

export async function updateHubspotStatus(
  nango: NangoProxy,
  nangoConnectionId: string,
  contactId: string,
  input: HubspotStatusInput,
): Promise<WritebackResult> {
  const res = await nango.patch({
    endpoint: `/crm/v3/objects/contacts/${contactId}`,
    providerConfigKey: "hubspot",
    connectionId: nangoConnectionId,
    data: {
      properties: { [input.field]: input.value },
    },
    retries: 3,
    retryOn: [429, 500, 502, 503, 504],
  });

  return { externalId: contactId, response: res.data };
}
