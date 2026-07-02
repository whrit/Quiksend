import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractMainTextFromHtml } from "./extract.ts";

describe("extractMainTextFromHtml", () => {
  it("extracts title and main text while stripping chrome tags", () => {
    const html = readFileSync(join(import.meta.dirname, "fixtures", "sample-page.html"), "utf8");
    const { title, mainText } = extractMainTextFromHtml(html);

    expect(title).toBe("Acme Corp — Workflow Automation");
    expect(mainText).toContain("Acme Corp");
    expect(mainText).toContain("grounded AI research");
    expect(mainText).not.toContain("Home | About");
    expect(mainText).not.toContain("Copyright 2025");
    expect(mainText).not.toContain("window.tracker");
  });

  it("falls back to body content when main is absent", () => {
    const html = `<html><body><p>Body-only content here.</p></body></html>`;
    const { mainText } = extractMainTextFromHtml(html);
    expect(mainText).toBe("Body-only content here.");
  });
});
