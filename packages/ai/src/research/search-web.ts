import { env } from "@quiksend/config";
import { createSearchProvider } from "../search/provider.ts";
import type { SearchProvider, SearchResult } from "../search/types.ts";

/**
 * Selection is by configured key. A key set for a provider MUST route to that
 * provider — silently falling through to "fake" would hand callers fabricated
 * research while the operator believes real search is running.
 *
 * In production, a missing real provider key is a configuration error rather
 * than a silent fallback to fake fixtures.
 */
function resolveSearchProviderId(): SearchProvider["id"] {
  if (env.BRAVE_API_KEY) return "brave";
  if (env.EXA_API_KEY) return "exa";
  if (env.TAVILY_API_KEY) return "tavily";
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Production requires a real search provider. Set BRAVE_API_KEY, EXA_API_KEY, or TAVILY_API_KEY.",
    );
  }
  return "fake";
}

export async function searchWeb(companyName: string): Promise<SearchResult[]> {
  const query = `${companyName} news OR announcement OR blog`;
  const provider = createSearchProvider(resolveSearchProviderId());
  return provider.search(query, { limit: 5, recency: "year" });
}
