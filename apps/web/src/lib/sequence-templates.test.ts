import { describe, expect, it } from "vitest";
import { extractTokens, renderPreview, validateTemplate } from "./sequence-templates.ts";

describe("sequence-templates", () => {
  it("extracts tokens with whitespace tolerance", () => {
    expect(extractTokens("Hi {{ first_name }}, from {{company_name}}")).toEqual([
      "first_name",
      "company_name",
    ]);
  });

  it("returns empty for strings without tokens", () => {
    expect(extractTokens("plain text")).toEqual([]);
  });

  it("validates known tokens", () => {
    expect(validateTemplate("{{ first_name }} {{ email }}")).toEqual({ valid: true, unknown: [] });
  });

  it("flags unknown tokens", () => {
    expect(validateTemplate("{{ foo_bar }} {{ first_name }}")).toEqual({
      valid: false,
      unknown: ["foo_bar"],
    });
  });

  it("renders preview with sample values", () => {
    const out = renderPreview("Hi {{ first_name }}, welcome to {{ company_name }}!");
    expect(out).toBe("Hi Alex, welcome to Acme Corp!");
  });

  it("replaces missing sample values with empty string", () => {
    expect(renderPreview("{{ unknown_token }}", {})).toBe("");
  });
});
