import { createSearchProvider } from "../search/provider.ts";
import type { SearchProvider, SearchResult } from "../search/types.ts";

function resolveSearchProviderId(): SearchProvider["id"] {
  if (process.env.EXA_API_KEY) return "exa";
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_API_KEY) return "brave";
  return "fake";
}

export async function searchWeb(companyName: string): Promise<SearchResult[]> {
  const query = `${companyName} news OR announcement OR blog`;
  try {
    const provider = createSearchProvider(resolveSearchProviderId());
    return provider.search(query, { limit: 5, recency: "year" });
  } catch {
    return createSearchProvider("fake").search(query, { limit: 5 });
  }
}
