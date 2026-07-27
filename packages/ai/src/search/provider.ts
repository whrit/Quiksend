import { env } from "@quiksend/config";
import { createBraveSearchProvider } from "./brave.ts";
import { createFakeSearchProvider } from "./fake.ts";
import type { SearchProvider, SearchResult } from "./types.ts";

const EXA_ENDPOINT = "https://api.exa.ai/search";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";

type Recency = "day" | "week" | "month" | "year" | null | undefined;

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function mapRecencyToExaStartPublishedDate(recency: Recency): string | null {
  if (!recency) return null;
  const start = new Date();
  switch (recency) {
    case "day":
      start.setDate(start.getDate() - 1);
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      break;
    case "month":
      start.setMonth(start.getMonth() - 1);
      break;
    case "year":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return null;
  }
  return start.toISOString();
}

function mapRecencyToTavilyTimeRange(recency: Recency): "day" | "week" | "month" | "year" | null {
  switch (recency) {
    case "day":
    case "week":
    case "month":
    case "year":
      return recency;
    default:
      return null;
  }
}

interface ExaSearchResult {
  readonly title?: string | null;
  readonly url?: string;
  readonly publishedDate?: string;
  readonly highlights?: readonly string[];
  readonly text?: string;
  readonly summary?: string;
}

interface ExaResponse {
  readonly results?: readonly ExaSearchResult[];
}

interface TavilySearchResult {
  readonly title?: string;
  readonly url?: string;
  readonly content?: string;
  readonly publishedDate?: string;
}

interface TavilyResponse {
  readonly results?: readonly TavilySearchResult[];
}

async function throwOnFailedResponse(provider: string, response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(
    `${provider} Search API request failed: ${response.status} ${response.statusText}${
      body ? ` — ${body.slice(0, 200)}` : ""
    }`,
  );
}

function createExaSearchProvider(apiKey: string): SearchProvider {
  if (!apiKey) {
    throw new Error("createExaSearchProvider: apiKey is required");
  }

  return {
    id: "exa",
    async search(query, options) {
      const trimmed = query.trim();
      if (!trimmed) return [];

      const limit = options?.limit ?? 10;
      const body: Record<string, unknown> = {
        query: trimmed,
        type: "auto",
        numResults: Math.max(1, Math.min(100, limit)),
        contents: { highlights: true },
      };
      const startPublishedDate = mapRecencyToExaStartPublishedDate(options?.recency);
      if (startPublishedDate) {
        body.startPublishedDate = startPublishedDate;
      }

      const response = await fetch(EXA_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });

      await throwOnFailedResponse("Exa", response);

      const payload = (await response.json()) as ExaResponse;
      const rawResults = payload.results ?? [];
      if (rawResults.length === 0) return [];

      const results: SearchResult[] = [];
      for (const raw of rawResults) {
        if (!raw.url || !raw.title) continue;
        let snippet = raw.highlights?.[0] ?? "";
        if (!snippet && raw.text) snippet = raw.text.slice(0, 300);
        if (!snippet && raw.summary) snippet = raw.summary;
        results.push({
          title: stripHtml(raw.title),
          url: raw.url,
          snippet: stripHtml(snippet),
          publishedAt: raw.publishedDate ?? null,
        });
      }
      return results.slice(0, limit);
    },
  };
}

function createTavilySearchProvider(apiKey: string): SearchProvider {
  if (!apiKey) {
    throw new Error("createTavilySearchProvider: apiKey is required");
  }

  return {
    id: "tavily",
    async search(query, options) {
      const trimmed = query.trim();
      if (!trimmed) return [];

      const limit = options?.limit ?? 10;
      const body: Record<string, unknown> = {
        query: trimmed,
        maxResults: Math.max(1, Math.min(20, limit)),
        topic: "news",
      };
      const timeRange = mapRecencyToTavilyTimeRange(options?.recency);
      if (timeRange) {
        body.timeRange = timeRange;
      }

      const response = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      await throwOnFailedResponse("Tavily", response);

      const payload = (await response.json()) as TavilyResponse;
      const rawResults = payload.results ?? [];
      if (rawResults.length === 0) return [];

      const results: SearchResult[] = [];
      for (const raw of rawResults) {
        if (!raw.url || !raw.title) continue;
        results.push({
          title: stripHtml(raw.title),
          url: raw.url,
          snippet: raw.content ? stripHtml(raw.content) : "",
          publishedAt: raw.publishedDate ?? null,
        });
      }
      return results.slice(0, limit);
    },
  };
}

export function createSearchProvider(id: SearchProvider["id"]): SearchProvider {
  switch (id) {
    case "fake":
      return createFakeSearchProvider();
    case "brave": {
      const apiKey = env.BRAVE_API_KEY;
      if (!apiKey) {
        throw new Error(
          'Search provider "brave" requires BRAVE_API_KEY. Set it or use "fake" in tests and local dev.',
        );
      }
      return createBraveSearchProvider(apiKey);
    }
    case "exa": {
      const apiKey = env.EXA_API_KEY;
      if (!apiKey) {
        throw new Error(
          'Search provider "exa" requires EXA_API_KEY. Set it or use "fake" in tests and local dev.',
        );
      }
      return createExaSearchProvider(apiKey);
    }
    case "tavily": {
      const apiKey = env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error(
          'Search provider "tavily" requires TAVILY_API_KEY. Set it or use "fake" in tests and local dev.',
        );
      }
      return createTavilySearchProvider(apiKey);
    }
    default:
      throw new Error(`Unsupported search provider: ${String(id)}`);
  }
}
