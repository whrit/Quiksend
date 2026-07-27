import { z } from "zod";
import type { ResearchFact } from "@quiksend/db/schema";

export const EmailSchema = z.object({
  subject: z.string().min(1).max(200),
  body_markdown: z.string().min(50).max(3000),
  angle: z.string(),
  cited_facts: z
    .array(
      z.object({
        claim: z.string().min(1),
        source_url: z.string().url().optional(),
      }),
    )
    .min(1),
});

export type EmailOutput = z.infer<typeof EmailSchema>;

function normalizeClaim(claim: string): string {
  return claim.trim().toLowerCase();
}

/** Ensure every cited fact matches a supplied research fact claim. */
export function assertGroundedCitations(
  citedFacts: EmailOutput["cited_facts"],
  researchFacts: readonly ResearchFact[],
): void {
  const researchClaims = new Set(researchFacts.map((fact) => normalizeClaim(fact.claim)));
  for (const cited of citedFacts) {
    if (!researchClaims.has(normalizeClaim(cited.claim))) {
      throw new Error(`Cited fact not found in research: ${cited.claim}`);
    }
  }
}
