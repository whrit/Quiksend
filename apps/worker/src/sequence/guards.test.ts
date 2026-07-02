import { describe, expect, it } from "vitest";
import { emailDomain, isProspectStatusSuppressed } from "./guards.ts";

describe("isProspectStatusSuppressed", () => {
  it("returns false for active prospect with no suppression row", () => {
    expect(isProspectStatusSuppressed("active")).toBe(false);
    expect(isProspectStatusSuppressed("new")).toBe(false);
  });

  it("returns true when prospect status is unsubscribed or do_not_contact", () => {
    expect(isProspectStatusSuppressed("unsubscribed")).toBe(true);
    expect(isProspectStatusSuppressed("do_not_contact")).toBe(true);
  });

  it("returns true when prospect status is bounced", () => {
    expect(isProspectStatusSuppressed("bounced")).toBe(true);
  });
});

describe("emailDomain", () => {
  it("extracts domain for domain-level suppression matching", () => {
    expect(emailDomain("user@blocked.com")).toBe("blocked.com");
    expect(emailDomain("USER@Example.COM")).toBe("example.com");
  });
});

describe("suppression matching logic", () => {
  it("domain suppression matches email at the domain", () => {
    const suppressedDomains = new Set(["blocked.com"]);
    const email = "user@blocked.com";
    expect(suppressedDomains.has(emailDomain(email))).toBe(true);
  });

  it("active status alone does not imply suppression without a table row", () => {
    expect(isProspectStatusSuppressed("active")).toBe(false);
  });
});
