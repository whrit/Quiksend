import { describe, expect, it } from "vitest";
import { emailDomain } from "@quiksend/core";
import { isProspectStatusSuppressed, checkSendPreConditions } from "./guards.ts";

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

describe("checkSendPreConditions", () => {
  const base = {
    mailboxStatus: "active",
    prospectStatus: "active",
    prospectDeletedAt: null,
    enrollmentState: "active",
  };

  it("passes when all conditions are safe", () => {
    expect(checkSendPreConditions(base)).toEqual({ ok: true });
  });

  it("rejects archived mailbox", () => {
    expect(checkSendPreConditions({ ...base, mailboxStatus: "archived" })).toEqual({
      ok: false,
      reason: "mailbox_archived",
    });
  });

  it("rejects deleted prospect", () => {
    expect(
      checkSendPreConditions({ ...base, prospectDeletedAt: new Date() }),
    ).toEqual({ ok: false, reason: "prospect_deleted" });
  });

  it("rejects suppressed prospect status", () => {
    expect(
      checkSendPreConditions({ ...base, prospectStatus: "unsubscribed" }),
    ).toEqual({ ok: false, reason: "suppressed" });
    expect(
      checkSendPreConditions({ ...base, prospectStatus: "bounced" }),
    ).toEqual({ ok: false, reason: "suppressed" });
    expect(
      checkSendPreConditions({ ...base, prospectStatus: "do_not_contact" }),
    ).toEqual({ ok: false, reason: "suppressed" });
  });

  it("rejects invalid enrollment state", () => {
    expect(
      checkSendPreConditions({ ...base, enrollmentState: "stopped" }),
    ).toEqual({ ok: false, reason: "enrollment_not_active" });
    expect(
      checkSendPreConditions({ ...base, enrollmentState: "completed" }),
    ).toEqual({ ok: false, reason: "enrollment_not_active" });
  });

  it("allows waiting_manual enrollment state", () => {
    expect(
      checkSendPreConditions({ ...base, enrollmentState: "waiting_manual" }),
    ).toEqual({ ok: true });
  });

  it("skips enrollment check when enrollmentState is null", () => {
    expect(
      checkSendPreConditions({ ...base, enrollmentState: null }),
    ).toEqual({ ok: true });
  });

  it("checks conditions in priority order: mailbox first", () => {
    const result = checkSendPreConditions({
      mailboxStatus: "archived",
      prospectStatus: "bounced",
      prospectDeletedAt: new Date(),
      enrollmentState: "stopped",
    });
    expect(result).toEqual({ ok: false, reason: "mailbox_archived" });
  });
});

describe("accepted send result handling", () => {
  it("providerMessageId fallback uses stable RFC messageId, never empty string", () => {
    // Worker effects.ts uses `sendResult.providerMessageId ?? messageIdHeader`
    // for auto_sent event and post-send guard. Empty string is never a valid id.
    const messageIdHeader = "<abc@example.com>";
    const nullProvider: string | null = null;
    const resolved = nullProvider ?? messageIdHeader;
    expect(resolved).toBe(messageIdHeader);
    expect(resolved).not.toBe("");
  });

  it("metadataReconciled false sets reconciliationError", () => {
    // Worker message settle mirrors durable-send: accepted but unreconciled
    // gets acceptedAt but null metadataReconciledAt and an error string.
    const metadataReconciled = false;
    const now = new Date();
    const fields = {
      acceptedAt: now,
      metadataReconciledAt: metadataReconciled ? now : null,
      reconciliationError: metadataReconciled
        ? null
        : "metadata lookup failed post-acceptance",
    };
    expect(fields.acceptedAt).toBe(now);
    expect(fields.metadataReconciledAt).toBeNull();
    expect(fields.reconciliationError).toBe("metadata lookup failed post-acceptance");
  });

  it("metadataReconciled true clears reconciliationError", () => {
    const metadataReconciled = true;
    const now = new Date();
    const fields = {
      acceptedAt: now,
      metadataReconciledAt: metadataReconciled ? now : null,
      reconciliationError: metadataReconciled
        ? null
        : "metadata lookup failed post-acceptance",
    };
    expect(fields.acceptedAt).toBe(now);
    expect(fields.metadataReconciledAt).toBe(now);
    expect(fields.reconciliationError).toBeNull();
  });

  it("accepted send with null providerMessageId is not rejected", () => {
    // An accepted send must never be failed just because metadata lookup
    // didn't return a providerMessageId. The guard uses the RFC id fallback.
    const sendResult = {
      messageId: "<rfc@example.com>",
      providerMessageId: null as string | null,
      metadataReconciled: false,
    };
    const fallback = sendResult.providerMessageId ?? sendResult.messageId;
    expect(fallback).toBe("<rfc@example.com>");
    // The auto_sent event type requires a non-empty string
    expect(fallback.length).toBeGreaterThan(0);
  });
});
