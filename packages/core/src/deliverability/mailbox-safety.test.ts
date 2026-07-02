import { describe, expect, it } from "vitest";
import {
  SEG_GATEWAYS,
  isMailboxSafeForGateway,
  isSegGateway,
  type MailboxSafetySnapshot,
} from "./mailbox-safety.ts";

const mailbox = (overrides: Partial<MailboxSafetySnapshot> = {}): MailboxSafetySnapshot => ({
  enterpriseSafe: false,
  enterpriseSafeAutoDowngraded: false,
  provider: "gmail",
  ...overrides,
});

describe("isMailboxSafeForGateway", () => {
  it("allows any mailbox for null gateway", () => {
    expect(isMailboxSafeForGateway(mailbox(), null)).toBe(true);
    expect(isMailboxSafeForGateway(mailbox({ enterpriseSafe: true }), null)).toBe(true);
  });

  it("allows any mailbox for non-SEG gateways", () => {
    for (const gateway of ["google_workspace", "microsoft_365", "unknown"] as const) {
      expect(isMailboxSafeForGateway(mailbox(), gateway)).toBe(true);
      expect(isMailboxSafeForGateway(mailbox({ enterpriseSafe: true }), gateway)).toBe(true);
    }
  });

  it("requires enterprise_safe for SEG gateways", () => {
    expect(isMailboxSafeForGateway(mailbox(), "proofpoint")).toBe(false);
    expect(isMailboxSafeForGateway(mailbox({ enterpriseSafe: true }), "proofpoint")).toBe(true);
  });

  it("auto-downgraded overrides enterprise_safe", () => {
    expect(
      isMailboxSafeForGateway(
        mailbox({ enterpriseSafe: true, enterpriseSafeAutoDowngraded: true }),
        "mimecast",
      ),
    ).toBe(false);
  });
});

describe("isSegGateway", () => {
  it("returns true for all 8 SEG gateway types", () => {
    for (const gateway of SEG_GATEWAYS) {
      expect(isSegGateway(gateway)).toBe(true);
    }
  });

  it("returns false for storage providers and other non-SEG gateways", () => {
    for (const gateway of [
      "google_workspace",
      "microsoft_365",
      "zoho",
      "fastmail",
      "other",
      "unknown",
    ] as const) {
      expect(isSegGateway(gateway)).toBe(false);
    }
    expect(isSegGateway(null)).toBe(false);
  });
});
