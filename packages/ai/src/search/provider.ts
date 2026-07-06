import { createBraveSearchProvider } from "./brave.ts";
import { createFakeSearchProvider } from "./fake.ts";
import type { SearchProvider } from "./types.ts";

export function createSearchProvider(id: SearchProvider["id"]): SearchProvider {
  switch (id) {
    case "fake":
      return createFakeSearchProvider();
    case "brave": {
      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        throw new Error(
          'Search provider "brave" requires BRAVE_API_KEY. Set it or use "fake" in tests and local dev.',
        );
      }
      return createBraveSearchProvider(apiKey);
    }
    case "exa":
    case "tavily":
      throw new Error(
        `Search provider "${id}" is not implemented yet. Use "brave" (with BRAVE_API_KEY) or "fake" for tests/dev.`,
      );
    default:
      throw new Error(`Unsupported search provider: ${String(id)}`);
  }
}
