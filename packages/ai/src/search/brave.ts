import type { SearchProvider, SearchResult } from "./types.ts";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/**
 * Thrown when Brave returns HTTP 429. Callers (research pipeline) inspect
 * `code === "rate_limited"` to decide whether to retry.
 */
export class BraveRateLimitError extends Error {
  readonly code = "rate_limited";
  readonly status = 429;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "BraveRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface BraveWebResult {
  readonly url?: string;
  readonly title?: string;
  readonly description?: string;
  readonly page_age?: string;
}

interface BraveResponse {
  readonly web?: {
    readonly results?: readonly BraveWebResult[];
  };
}

/**
 * Maps our recency filter to Brave's `freshness` parameter.
 * See https://api-dashboard.search.brave.com/api-reference/web/search/get
 */
function mapRecency(recency: "day" | "week" | "month" | "year" | null | undefined): string | null {
  switch (recency) {
    case "day":
      return "pd";
    case "week":
      return "pw";
    case "month":
      return "pm";
    case "year":
      return "py";
    default:
      return null;
  }
}

export function createBraveSearchProvider(apiKey: string): SearchProvider {
  if (!apiKey) {
    throw new Error("createBraveSearchProvider: apiKey is required");
  }

  return {
    id: "brave",
    async search(query, options) {
      const trimmed = query.trim();
      if (!trimmed) return [];

      const url = new URL(BRAVE_ENDPOINT);
      url.searchParams.set("q", trimmed);
      const limit = options?.limit ?? 10;
      url.searchParams.set("count", String(Math.max(1, Math.min(20, limit))));
      const freshness = mapRecency(options?.recency);
      if (freshness) {
        url.searchParams.set("freshness", freshness);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      });

      if (response.status === 429) {
        const retryHeader = response.headers.get("retry-after");
        const retrySeconds = retryHeader === null ? Number.NaN : Number.parseInt(retryHeader, 10);
        throw new BraveRateLimitError(
          "Brave Search API rate limit exceeded (HTTP 429)",
          Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds : null,
        );
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Brave Search API request failed: ${response.status} ${response.statusText}${
            body ? ` — ${body.slice(0, 200)}` : ""
          }`,
        );
      }

      const payload = (await response.json()) as BraveResponse;
      const rawResults = payload.web?.results ?? [];
      if (rawResults.length === 0) return [];

      const results: SearchResult[] = [];
      for (const raw of rawResults) {
        if (!raw.url || !raw.title) continue;
        results.push({
          title: raw.title.replace(/<[^>]+>/g, ""),
          url: raw.url,
          snippet: raw.description ? raw.description.replace(/<[^>]+>/g, "") : "",
          publishedAt: raw.page_age ?? null,
        });
      }
      return results.slice(0, limit);
    },
  };
}
