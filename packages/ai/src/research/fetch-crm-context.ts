import { db, tables } from "@quiksend/db";
import { getNango } from "@quiksend/integrations/nango";
import { env } from "@quiksend/config";
import { and, eq } from "drizzle-orm";

export type CrmActivityItem = {
  type: string;
  subject: string;
  date: string;
};

export type CrmContext = {
  provider: "salesforce" | "hubspot";
  prospect: Record<string, unknown>;
  company: Record<string, unknown> | null;
  recentActivity: CrmActivityItem[];
};

type FetchCrmContextInput = {
  organizationId: string;
  prospectId: string;
};

export async function fetchCrmContext(input: FetchCrmContextInput): Promise<CrmContext | null> {
  if (!env.NANGO_SECRET_KEY) return null;

  const prospect = await db.query.prospect.findFirst({
    where: and(
      eq(tables.prospect.id, input.prospectId),
      eq(tables.prospect.organizationId, input.organizationId),
    ),
    with: { company: true },
  });
  if (!prospect?.crmExternalId) return null;

  const connection = prospect.crmConnectionId
    ? await db.query.crmConnection.findFirst({
        where: and(
          eq(tables.crmConnection.id, prospect.crmConnectionId),
          eq(tables.crmConnection.organizationId, input.organizationId),
          eq(tables.crmConnection.status, "active"),
        ),
      })
    : await db.query.crmConnection.findFirst({
        where: and(
          eq(tables.crmConnection.organizationId, input.organizationId),
          eq(tables.crmConnection.status, "active"),
        ),
      });

  if (!connection) return null;

  const nango = getNango();
  const contactId = prospect.crmExternalId;

  try {
    if (connection.provider === "salesforce") {
      const contactRes = await nango.proxy({
        connectionId: connection.nangoConnectionId,
        providerConfigKey: "salesforce",
        endpoint: `/services/data/v59.0/sobjects/Contact/${contactId}`,
        method: "GET",
      });
      const contact = contactRes.data as Record<string, unknown>;
      let company: Record<string, unknown> | null = null;
      const accountId = contact.AccountId;
      if (typeof accountId === "string") {
        const accountRes = await nango.proxy({
          connectionId: connection.nangoConnectionId,
          providerConfigKey: "salesforce",
          endpoint: `/services/data/v59.0/sobjects/Account/${accountId}`,
          method: "GET",
        });
        company = accountRes.data as Record<string, unknown>;
      }
      const activityRes = await nango.proxy({
        connectionId: connection.nangoConnectionId,
        providerConfigKey: "salesforce",
        endpoint: `/services/data/v59.0/query`,
        method: "GET",
        params: {
          q: `SELECT Id, Subject, ActivityDate, TaskSubtype FROM Task WHERE WhoId = '${contactId}' ORDER BY ActivityDate DESC LIMIT 5`,
        },
      });
      const records =
        ((activityRes.data as { records?: unknown[] })?.records as Array<{
          TaskSubtype?: string;
          Subject?: string;
          ActivityDate?: string;
        }>) ?? [];
      return {
        provider: "salesforce",
        prospect: contact,
        company,
        recentActivity: records.map((r) => ({
          type: r.TaskSubtype ?? "task",
          subject: r.Subject ?? "",
          date: r.ActivityDate ?? "",
        })),
      };
    }

    const contactRes = await nango.proxy({
      connectionId: connection.nangoConnectionId,
      providerConfigKey: "hubspot",
      endpoint: `/crm/v3/objects/contacts/${contactId}`,
      method: "GET",
      params: { properties: "firstname,lastname,email,jobtitle,company,hs_lastmodifieddate" },
    });
    const contact = contactRes.data as Record<string, unknown>;
    let company: Record<string, unknown> | null = null;
    const props = (contact.properties as Record<string, string> | undefined) ?? {};
    if (props.company) {
      const companyRes = await nango.proxy({
        connectionId: connection.nangoConnectionId,
        providerConfigKey: "hubspot",
        endpoint: `/crm/v3/objects/companies/search`,
        method: "POST",
        data: {
          filterGroups: [
            {
              filters: [{ propertyName: "name", operator: "EQ", value: props.company }],
            },
          ],
          limit: 1,
        },
      });
      const results = (companyRes.data as { results?: Record<string, unknown>[] })?.results;
      company = results?.[0] ?? null;
    }
    const notesRes = await nango.proxy({
      connectionId: connection.nangoConnectionId,
      providerConfigKey: "hubspot",
      endpoint: `/crm/v3/objects/notes/search`,
      method: "POST",
      data: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "associations.contact",
                operator: "EQ",
                value: contactId,
              },
            ],
          },
        ],
        limit: 5,
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      },
    });
    const notes = (notesRes.data as { results?: Array<{ properties?: Record<string, string> }> })
      ?.results;
    return {
      provider: "hubspot",
      prospect: contact,
      company,
      recentActivity:
        notes?.map((n) => ({
          type: "note",
          subject: n.properties?.hs_note_body?.slice(0, 120) ?? "Note",
          date: n.properties?.hs_timestamp ?? "",
        })) ?? [],
    };
  } catch {
    return null;
  }
}
