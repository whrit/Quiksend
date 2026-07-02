export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

export interface SearchProvider {
  readonly id: "exa" | "tavily" | "brave" | "fake";
  search(
    query: string,
    options?: {
      limit?: number;
      recency?: "day" | "week" | "month" | "year" | null;
    },
  ): Promise<SearchResult[]>;
}
