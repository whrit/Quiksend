import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MailboxAdapter, SendResult } from "@quiksend/mail";

const mockSend = vi.fn<MailboxAdapter["send"]>(async () => ({
  messageId: "<test@mail.example>",
  providerMessageId: "prov-1",
  providerThreadId: "thread-1",
  sentAt: new Date("2026-01-01T00:00:00Z"),
}));

vi.mock("@quiksend/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/mail")>();
  return {
    ...actual,
    createAdapterForMailbox: vi.fn<typeof createAdapterForMailboxStub>(() => ({
      provider: "gmail" as const,
      send: mockSend,
      listInbound: vi.fn<MailboxAdapter["listInbound"]>(),
      verifyIdentity: vi.fn<MailboxAdapter["verifyIdentity"]>(),
    })),
  };
});

function createAdapterForMailboxStub(): MailboxAdapter {
  return {
    provider: "gmail",
    send: mockSend,
    listInbound: vi.fn<MailboxAdapter["listInbound"]>(),
    verifyIdentity: vi.fn<MailboxAdapter["verifyIdentity"]>(),
  };
}

vi.mock("@quiksend/config", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
    MAILBOX_ENCRYPTION_KEY: "a".repeat(64),
    NANGO_SECRET_KEY: "nango-test",
  },
}));

import { createAdapterForMailbox } from "@quiksend/mail";
import { buildThreadingHeaders } from "@quiksend/mail/threading";
import { resolveMailboxAdapter } from "./mailboxes.functions.ts";

describe("resolveMailboxAdapter", () => {
  beforeEach(() => {
    vi.mocked(createAdapterForMailbox).mockClear();
    mockSend.mockClear();
  });

  it("uses createAdapterForMailbox for Gmail mailboxes", async () => {
    const adapter = resolveMailboxAdapter({
      id: "mb-1",
      organizationId: "org-1",
      ownerUserId: "user-1",
      provider: "gmail",
      address: "sender@example.com",
      displayName: null,
      fromName: "Sender",
      nangoConnectionId: "nango-conn-1",
      smtpConfig: null,
      dailyCap: 50,
      sendWindow: { timezone: "UTC", window: {} },
      throttleSeconds: 90,
      signatureHtml: null,
      spfOk: null,
      dkimOk: null,
      dmarcOk: null,
      healthCheckedAt: null,
      healthNotes: null,
      pollCursor: null,
      enterpriseSafe: false,
      enterpriseSafeReason: null,
      enterpriseSafeDeclaredAt: null,
      enterpriseSafeAutoDowngraded: false,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const threading = buildThreadingHeaders({
      messageId: "<anchor@example.com>",
      subject: "Hello",
      providerThreadId: "thread-0",
      priorReferences: [],
    });

    const result: SendResult = await adapter.send({
      from: { email: "sender@example.com", name: "Sender" },
      to: [{ email: "prospect@example.com", name: "Prospect" }],
      subject: threading.subject,
      html: "<p>Hi</p>",
      text: "Hi",
      threading,
    });

    expect(result.providerMessageId).toBe("prov-1");
    expect(createAdapterForMailbox).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gmail",
        nangoConnectionId: "nango-conn-1",
      }),
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        threading: expect.objectContaining({ inReplyTo: "<anchor@example.com>" }),
      }),
    );
  });
});
