import type { SearchProvider, SearchResult } from "./types.ts";

const FIXTURES: Readonly<Record<string, readonly SearchResult[]>> = {
  "acme corp funding": [
    {
      title: "Acme Corp raises Series B",
      url: "https://news.example.com/acme-series-b",
      snippet: "Acme Corp announced a $40M Series B to expand its sales platform.",
      publishedAt: "2025-11-12T00:00:00.000Z",
    },
    {
      title: "Acme Corp company profile",
      url: "https://www.example.com/companies/acme",
      snippet: "Acme Corp builds workflow automation for revenue teams.",
      publishedAt: null,
    },
  ],
  "jane doe vp sales": [
    {
      title: "Jane Doe promoted to VP Sales at Acme",
      url: "https://linkedin.example.com/posts/jane-doe-vp",
      snippet: "Jane Doe joined Acme as VP Sales after leading GTM at ExampleCo.",
      publishedAt: "2025-10-01T00:00:00.000Z",
    },
  ],
};

const DEFAULT_RESULTS: readonly SearchResult[] = [
  {
    title: "No fixture match",
    url: "https://example.com/no-results",
    snippet: "Fake search provider default result for unknown queries.",
    publishedAt: null,
  },
];

export function createFakeSearchProvider(): SearchProvider {
  return {
    id: "fake",
    async search(query, options) {
      const base = FIXTURES[query.toLowerCase()] ?? DEFAULT_RESULTS;
      const limit = options?.limit ?? base.length;
      return [...base].slice(0, limit);
    },
  };
}
