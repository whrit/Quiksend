import { describe, expect, it } from "vitest";
import { assertGroundedCitations } from "./email-schema.ts";

describe("assertGroundedCitations", () => {
  const researchFacts = [
    {
      claim: "Company raised Series B",
      source_url: "https://example.com/news",
      confidence: 0.9,
    },
  ];

  it("accepts citations that match research fact claims", () => {
    expect(() =>
      assertGroundedCitations(
        [{ claim: "Company raised Series B", source_url: "https://example.com/news" }],
        researchFacts,
      ),
    ).not.toThrow();
  });

  it("rejects citations not present in research facts", () => {
    expect(() => assertGroundedCitations([{ claim: "Invented fact" }], researchFacts)).toThrow(
      /not found in research/,
    );
  });
});
