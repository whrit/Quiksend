import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MailboxAdapter } from "@quiksend/mail";

const mockSend = vi.fn<MailboxAdapter["send"]>(async () => ({
  messageId: "<compose@example.com>",
  providerMessageId: "gmail-msg-1",
  providerThreadId: "gmail-thread-1",
  sentAt: new Date("2026-01-01T12:00:00Z"),
}));

vi.mock("./mailboxes.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mailboxes.server.ts")>();
  return {
    ...actual,
    resolveMailboxAdapter: vi.fn<typeof actual.resolveMailboxAdapter>(() => ({
      provider: "gmail" as const,
      send: mockSend,
      listInbound: vi.fn<MailboxAdapter["listInbound"]>(),
      verifyIdentity: vi.fn<MailboxAdapter["verifyIdentity"]>(),
    })),
  };
});

import { resolveMailboxAdapter } from "./mailboxes.server.ts";
import { buildThreadingHeaders } from "@quiksend/mail/threading";

describe("compose send via adapter", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.mocked(resolveMailboxAdapter).mockClear();
  });

  it("sends Gmail compose through adapter with threading", async () => {
    const adapter = resolveMailboxAdapter({
      id: "mb-1",
      provider: "gmail",
      address: "rep@example.com",
      fromName: "Rep",
      nangoConnectionId: "nango-1",
      smtpConfig: null,
    } as never);

    const threading = buildThreadingHeaders({
      messageId: "<inbound@example.com>",
      subject: "Question",
      providerThreadId: "t-1",
      priorReferences: ["<prior@example.com>"],
    });

    await adapter.send({
      from: { email: "rep@example.com" },
      to: [{ email: "prospect@example.com" }],
      subject: threading.subject,
      html: "<p>Reply body</p>",
      text: "Reply body",
      threading,
      extraHeaders: { "List-Unsubscribe": "<http://localhost/u>" },
    });

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        threading: expect.objectContaining({
          inReplyTo: "<inbound@example.com>",
        }),
        extraHeaders: expect.objectContaining({ "List-Unsubscribe": expect.any(String) }),
      }),
    );
  });
});
