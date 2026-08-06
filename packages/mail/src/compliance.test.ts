import { describe, expect, it } from "vitest";
import { resolvePostalAddress, ComplianceConfigurationError } from "./compliance.ts";

describe("resolvePostalAddress", () => {
  it("returns trimmed address from valid metadata", () => {
    const address = resolvePostalAddress({
      organizationId: "org-1",
      metadata: JSON.stringify({ postal_address: "  123 Real St, City, ST 12345  " }),
    });
    expect(address).toBe("123 Real St, City, ST 12345");
  });

  it("throws ComplianceConfigurationError when metadata is null", () => {
    expect(() => resolvePostalAddress({ organizationId: "org-1", metadata: null })).toThrow(
      ComplianceConfigurationError,
    );
    expect(() => resolvePostalAddress({ organizationId: "org-1", metadata: null })).toThrow(
      "Workspace postal address is required",
    );
  });

  it("throws ComplianceConfigurationError when metadata has no postal_address", () => {
    expect(() =>
      resolvePostalAddress({ organizationId: "org-1", metadata: JSON.stringify({}) }),
    ).toThrow(ComplianceConfigurationError);
  });

  it("throws ComplianceConfigurationError when postal_address is blank", () => {
    expect(() =>
      resolvePostalAddress({
        organizationId: "org-1",
        metadata: JSON.stringify({ postal_address: "   " }),
      }),
    ).toThrow(ComplianceConfigurationError);
  });

  it("throws ComplianceConfigurationError when metadata is invalid JSON", () => {
    expect(() => resolvePostalAddress({ organizationId: "org-1", metadata: "not-json" })).toThrow(
      ComplianceConfigurationError,
    );
  });
});
