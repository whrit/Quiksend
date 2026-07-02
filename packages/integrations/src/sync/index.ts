export type { NormalizedAccount, NormalizedContact, SyncCursor, SyncPage } from "./types.ts";
export { parseSyncCursor, serializeSyncCursor } from "./types.ts";
export {
  fetchChangedHubspotAccounts,
  fetchChangedHubspotContacts,
  fetchChangedSalesforceAccounts,
  fetchChangedSalesforceContacts,
} from "./fetch-changed-records.ts";
export { upsertAccounts, upsertContacts, linkContactsToCompanies } from "./upsert.ts";
