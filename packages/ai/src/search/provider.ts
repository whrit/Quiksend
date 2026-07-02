import { createFakeSearchProvider } from "./fake.ts";
import type { SearchProvider } from "./types.ts";

export function createSearchProvider(id: SearchProvider["id"]): SearchProvider {
  switch (id) {
    case "fake":
      return createFakeSearchProvider();
    case "exa":
    case "tavily":
    case "brave":
      throw new Error(
        `Search provider "${id}" is not implemented yet. Use "fake" in tests and local dev.`,
      );
    default:
      throw new Error(`Unsupported search provider: ${String(id)}`);
  }
}
