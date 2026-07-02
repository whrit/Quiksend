export const MS_DELTA_PAGE_CAP = 20;

export interface GraphDeltaMessage {
  readonly id: string;
  readonly conversationId?: string;
  readonly receivedDateTime?: string;
}

export interface GraphDeltaPage {
  readonly value?: readonly GraphDeltaMessage[];
  readonly "@odata.deltaLink"?: string;
  readonly "@odata.nextLink"?: string;
}

export function graphEndpointFromDeltaLink(deltaLink?: string): string {
  if (!deltaLink) return "/v1.0/me/mailFolders/inbox/messages/delta";
  return deltaLink.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "");
}

export function dedupeGraphMessages<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function filterMessagesSince(
  items: readonly GraphDeltaMessage[],
  since: Date,
): GraphDeltaMessage[] {
  return items.filter((item) => item.receivedDateTime && new Date(item.receivedDateTime) >= since);
}
