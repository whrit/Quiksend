import { generateText, Output } from "ai";
import { z } from "zod";
import { fetchAndExtract } from "../fetch/extract.ts";
import { getDefaultModel } from "../model/provider.ts";
import type { ResearchFact } from "@quiksend/db/schema";
import type { SearchResult } from "../search/types.ts";
import { UNTRUSTED_SOURCE_SYSTEM_GUARD, wrapUntrustedSource } from "./untrusted-source.ts";

const FactsSchema = z.object({
  facts: z.array(
    z.object({
      claim: z.string().min(1),
      source_url: z.string().url(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export async function fetchAndSummarize(results: SearchResult[]): Promise<ResearchFact[]> {
  const pages = await Promise.all(
    results.slice(0, 5).map(async (result) => {
      try {
        const page = await fetchAndExtract(result.url);
        return { result, page };
      } catch {
        return null;
      }
    }),
  );

  const validPages = pages.filter((p): p is NonNullable<typeof p> => p !== null);
  if (validPages.length === 0) return [];

  const sourceBlocks = validPages
    .map(({ result, page }) =>
      wrapUntrustedSource(
        page.finalUrl,
        `Title: ${result.title}\nSnippet: ${result.snippet}\nContent:\n${page.mainText.slice(0, 4000)}`,
      ),
    )
    .join("\n\n");

  const { output } = await generateText({
    model: getDefaultModel(),
    output: Output.object({ schema: FactsSchema }),
    system: UNTRUSTED_SOURCE_SYSTEM_GUARD,
    prompt:
      "Extract up to 8 concise, verifiable facts about the company from the sources below. " +
      "Each fact must cite the source URL it came from and include a confidence score (0-1).\n\n" +
      sourceBlocks,
  });

  return output.facts;
}
