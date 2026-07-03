import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MailboxAdapter } from "@quiksend/mail";

const mockSend = vi.fn<MailboxAdapter["send"]>(async () => ({
  messageId: "<reply@example.com>",
  providerMessageId: "gmail-reply-1",
  providerThreadId: "gmail-thread-1",
  sentAt: new Date("2026-01-02T12:00:00Z"),
}));

vi.mock("./mailboxes.server.ts", () => ({
  resolveMailboxAdapter: vi.fn<() => MailboxAdapter>(() => ({
    provider: "gmail",
    send: mockSend,
    listInbound: vi.fn<MailboxAdapter["listInbound"]>(),
    verifyIdentity: vi.fn<MailboxAdapter["verifyIdentity"]>(),
  })),
}));

import { resolveMailboxAdapter } from "./mailboxes.server.ts";
import { buildThreadingHeaders } from "@quiksend/mail/threading";

describe("inbox reply send via adapter", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.mocked(resolveMailboxAdapter).mockClear();
  });

  it("uses adapter.send for Gmail reply with MIME threading", async () => {
    const adapter = resolveMailboxAdapter({ provider: "gmail" } as never);
    const threading = buildThreadingHeaders({
      messageId: "<inbound@example.com>",
      subject: "Re: Outreach",
      providerThreadId: "thread-abc",
      priorReferences: ["<outbound@example.com>"],
    });

    await adapter.send({
      from: { email: "rep@example.com", name: "Rep" },
      to: [{ email: "prospect@example.com" }],
      subject: threading.subject,
      html: "<p>Thanks for your note</p>",
      text: "Thanks for your note",
      threading,
      extraHeaders: { "List-Unsubscribe": "<http://localhost/u>" },
    });

    expect(resolveMailboxAdapter).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        threading: expect.objectContaining({ subject: "Re: Outreach" }),
        to: [{ email: "prospect@example.com" }],
      }),
    );
  });
});
