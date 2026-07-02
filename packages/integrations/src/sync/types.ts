export interface NormalizedContact {
  externalId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  companyExternalId: string | null;
  lastModifiedISO: string;
}

export interface NormalizedAccount {
  externalId: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  size: number | null;
  website: string | null;
  lastModifiedISO: string;
}

export interface SyncPage<T> {
  records: T[];
  nextCursor: string | null;
}

export interface SyncCursor {
  modifiedAfter?: string | null;
  nangoCursor?: string | null;
}

export function parseSyncCursor(raw: unknown): SyncCursor {
  if (!raw || typeof raw !== "object") return {};
  const c = raw as Record<string, unknown>;
  return {
    modifiedAfter: typeof c.modifiedAfter === "string" ? c.modifiedAfter : null,
    nangoCursor: typeof c.nangoCursor === "string" ? c.nangoCursor : null,
  };
}

export function serializeSyncCursor(cursor: SyncCursor): SyncCursor {
  const out: SyncCursor = {};
  if (cursor.modifiedAfter) out.modifiedAfter = cursor.modifiedAfter;
  if (cursor.nangoCursor) out.nangoCursor = cursor.nangoCursor;
  return out;
}
