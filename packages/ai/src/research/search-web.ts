import { env } from "@quiksend/config";
import { createSearchProvider } from "../search/provider.ts";
import type { SearchProvider, SearchResult } from "../search/types.ts";

function resolveSearchProviderId(): SearchProvider["id"] {
  if (env.BRAVE_API_KEY) return "brave";
  return "fake";
}

export async function searchWeb(companyName: string): Promise<SearchResult[]> {
  const query = `${companyName} news OR announcement OR blog`;
  const provider = createSearchProvider(resolveSearchProviderId());
  return provider.search(query, { limit: 5, recency: "year" });
}
