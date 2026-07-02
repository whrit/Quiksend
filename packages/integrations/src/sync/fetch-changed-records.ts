import type { FieldMapping } from "../providers/types.ts";
import { getNango } from "../nango.ts";
import type { NormalizedAccount, NormalizedContact, SyncPage } from "./types.ts";

type RawRecord = Record<string, unknown>;

function readField(record: RawRecord, fieldName: string): unknown {
  if (fieldName in record) return record[fieldName];
  const nested = record.fields;
  if (nested && typeof nested === "object" && fieldName in (nested as RawRecord)) {
    return (nested as RawRecord)[fieldName];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = website.includes("://") ? website : `https://${website}`;
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return website.toLowerCase().replace(/^www\./, "");
  }
}

function lastModified(record: RawRecord): string {
  const meta = record["_nango_metadata"];
  if (meta && typeof meta === "object") {
    const last = (meta as RawRecord).last_modified_at;
    if (typeof last === "string") return last;
  }
  const updated = readField(record, "LastModifiedDate") ?? readField(record, "hs_lastmodifieddate");
  if (typeof updated === "string") return updated;
  return new Date().toISOString();
}

function mapContact(record: RawRecord, mapping: FieldMapping): NormalizedContact {
  const email = asString(readField(record, mapping.prospect.email));
  const companyRef =
    readField(record, "AccountId") ??
    readField(record, "associatedcompanyid") ??
    readField(record, "company_id");
  return {
    externalId: asString(record.id) ?? "",
    email: email?.toLowerCase() ?? null,
    firstName: asString(readField(record, mapping.prospect.firstName)),
    lastName: asString(readField(record, mapping.prospect.lastName)),
    title: asString(readField(record, mapping.prospect.title)),
    linkedinUrl: asString(readField(record, mapping.prospect.linkedinUrl)),
    phone: asString(readField(record, mapping.prospect.phone)),
    companyExternalId: asString(companyRef),
    lastModifiedISO: lastModified(record),
  };
}

function mapAccount(record: RawRecord, mapping: FieldMapping): NormalizedAccount {
  const website = asString(readField(record, mapping.company.website));
  const domainField = asString(readField(record, mapping.company.domain));
  return {
    externalId: asString(record.id) ?? "",
    name: asString(readField(record, mapping.company.name)),
    domain: extractDomain(domainField ?? website),
    industry: asString(readField(record, mapping.company.industry)),
    size: asNumber(readField(record, mapping.company.size)),
    website,
    lastModifiedISO: lastModified(record),
  };
}

export async function fetchChangedSalesforceContacts(
  connectionId: string,
  fieldMapping: FieldMapping,
  sinceCursor: string | null,
  nangoCursor?: string | null,
): Promise<SyncPage<NormalizedContact>> {
  const nango = getNango();
  const result = await nango.listRecords<RawRecord>({
    providerConfigKey: "salesforce",
    connectionId,
    model: "Contact",
    modifiedAfter: nangoCursor ? undefined : (sinceCursor ?? undefined),
    cursor: nangoCursor ?? undefined,
    limit: 100,
  });
  const records = result.records
    .map((r) => mapContact(r, fieldMapping))
    .filter((r) => r.externalId);
  return { records, nextCursor: result.next_cursor };
}

export async function fetchChangedSalesforceAccounts(
  connectionId: string,
  fieldMapping: FieldMapping,
  sinceCursor: string | null,
  nangoCursor?: string | null,
): Promise<SyncPage<NormalizedAccount>> {
  const nango = getNango();
  const result = await nango.listRecords<RawRecord>({
    providerConfigKey: "salesforce",
    connectionId,
    model: "Account",
    modifiedAfter: nangoCursor ? undefined : (sinceCursor ?? undefined),
    cursor: nangoCursor ?? undefined,
    limit: 100,
  });
  const records = result.records
    .map((r) => mapAccount(r, fieldMapping))
    .filter((r) => r.externalId);
  return { records, nextCursor: result.next_cursor };
}

export async function fetchChangedHubspotContacts(
  connectionId: string,
  fieldMapping: FieldMapping,
  sinceCursor: string | null,
  nangoCursor?: string | null,
): Promise<SyncPage<NormalizedContact>> {
  const nango = getNango();
  const result = await nango.listRecords<RawRecord>({
    providerConfigKey: "hubspot",
    connectionId,
    model: "Contact",
    modifiedAfter: nangoCursor ? undefined : (sinceCursor ?? undefined),
    cursor: nangoCursor ?? undefined,
    limit: 100,
  });
  const records = result.records
    .map((r) => mapContact(r, fieldMapping))
    .filter((r) => r.externalId);
  return { records, nextCursor: result.next_cursor };
}

export async function fetchChangedHubspotAccounts(
  connectionId: string,
  fieldMapping: FieldMapping,
  sinceCursor: string | null,
  nangoCursor?: string | null,
): Promise<SyncPage<NormalizedAccount>> {
  const nango = getNango();
  const result = await nango.listRecords<RawRecord>({
    providerConfigKey: "hubspot",
    connectionId,
    model: "Company",
    modifiedAfter: nangoCursor ? undefined : (sinceCursor ?? undefined),
    cursor: nangoCursor ?? undefined,
    limit: 100,
  });
  const records = result.records
    .map((r) => mapAccount(r, fieldMapping))
    .filter((r) => r.externalId);
  return { records, nextCursor: result.next_cursor };
}
