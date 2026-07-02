import { describe, expect, it } from "vitest";
import {
  normalizeDomain,
  normalizeEmail,
  parseCsvStream,
  type CsvColumnMapping,
} from "./prospect-import.ts";

describe("normalizeEmail", () => {
  it("lowercases and trims valid emails", () => {
    expect(normalizeEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });

  it("returns null for invalid emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("@missing.com")).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("extracts corporate domains from URLs", () => {
    expect(normalizeDomain("https://www.AcmeCorp.io/about")).toBe("acmecorp.io");
  });

  it("rejects free-mail providers", () => {
    expect(normalizeDomain("gmail.com")).toBeNull();
    expect(normalizeDomain("yahoo.com")).toBeNull();
    expect(normalizeDomain("outlook.com")).toBeNull();
  });

  it("rejects invalid domains", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("nodots")).toBeNull();
    expect(normalizeDomain("user@gmail.com")).toBeNull();
  });
});

describe("parseCsvStream", () => {
  const mapping: CsvColumnMapping = {
    Email: "email",
    "First Name": "firstName",
    "Last Name": "lastName",
    Company: "companyName",
    Title: "title",
  };

  it("parses valid rows and flags invalid ones", async () => {
    const csv = `Email,First Name,Last Name,Company,Title
alice@acme.io,Alice,Anderson,Acme Corp,CEO
,Bob,,,
carol@bad,Bob,Brown,,
dave@acme.io,Dave,Doe,Acme Corp,CTO
`;

    const result = await parseCsvStream(csv, mapping);

    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]?.prospect.email).toBe("alice@acme.io");
    expect(result.valid[0]?.company?.name).toBe("Acme Corp");
    expect(result.valid[1]?.prospect.email).toBe("dave@acme.io");

    expect(result.invalid).toHaveLength(2);
    expect(result.invalid.some((r) => r.reason === "Missing email")).toBe(true);
    expect(result.invalid.some((r) => r.reason === "Invalid email address")).toBe(true);
  });

  it("marks blank rows as invalid", async () => {
    const csv = `Email,First Name
,
`;
    const result = await parseCsvStream(csv, mapping);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid.length).toBeGreaterThan(0);
  });
});
