import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BraveRateLimitError, createBraveSearchProvider } from "./brave.ts";

describe("createBraveSearchProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn<typeof fetch>();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends the API key + JSON headers and maps Brave results to SearchResult", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                url: "https://news.example.com/acme",
                title: "Acme raises <strong>$40M</strong>",
                description: "Acme Corp <b>announced</b> a Series B round.",
                page_age: "2025-11-12T00:00:00Z",
              },
              {
                url: "https://example.com/acme",
                title: "Acme Corp profile",
                description: "Workflow automation for revenue teams.",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createBraveSearchProvider("test-key");
    const results = await provider.search("acme corp funding", {
      limit: 5,
      recency: "year",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(typeof calledUrl).toBe("string");
    const url = new URL(calledUrl as string);
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("acme corp funding");
    expect(url.searchParams.get("count")).toBe("5");
    expect(url.searchParams.get("freshness")).toBe("py");
    expect(calledInit?.method).toBe("GET");
    const headers = calledInit?.headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe("test-key");
    expect(headers.Accept).toBe("application/json");
    expect(headers["Accept-Encoding"]).toBe("gzip");

    expect(results).toEqual([
      {
        title: "Acme raises $40M",
        url: "https://news.example.com/acme",
        snippet: "Acme Corp announced a Series B round.",
        publishedAt: "2025-11-12T00:00:00Z",
      },
      {
        title: "Acme Corp profile",
        url: "https://example.com/acme",
        snippet: "Workflow automation for revenue teams.",
        publishedAt: null,
      },
    ]);
  });

  it("returns [] when Brave responds with no web results", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
    );
    const provider = createBraveSearchProvider("test-key");
    const results = await provider.search("nothing here");
    expect(results).toEqual([]);
  });

  it("throws BraveRateLimitError with retry-after seconds on HTTP 429", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "42" },
      }),
    );
    const provider = createBraveSearchProvider("test-key");
    const err = await provider.search("anything").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BraveRateLimitError);
    expect(err).toMatchObject({
      name: "BraveRateLimitError",
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 42,
    });
  });

  it("throws a plain Error on non-2xx, non-429 responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("boom", { status: 500, statusText: "Server Error" }),
    );
    const provider = createBraveSearchProvider("test-key");
    await expect(provider.search("anything")).rejects.toThrow(/Brave Search API request failed/);
  });
});
