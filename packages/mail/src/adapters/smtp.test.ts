/**
 * SMTP adapter unit tests mock nodemailer rather than `createFakeAdapter`.
 * They verify MIME construction, threading headers in raw output, and SMTP
 * error classification — behaviors that depend on nodemailer's sendMail contract.
 * Use `createFakeAdapter` for worker/sequence tests that only need send recording.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComplianceInput } from "../compliance.ts";
import type { OutboundEmail } from "../adapter.ts";
import { SendError } from "../adapter.ts";
import { createSmtpAdapter, sendMime } from "./smtp.ts";

const sendMail = vi.fn<(message: { raw?: string }) => Promise<{ messageId?: string }>>();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn<() => { sendMail: typeof sendMail }>(() => ({ sendMail })),
  },
}));

const compliance: ComplianceInput = {
  unsubscribeUrl: "https://app.example.com/u/pending",
  senderPostalAddress: "1 Main St",
  senderOrgName: "Acme",
};

describe("createSmtpAdapter", () => {
  afterEach(() => {
    sendMail.mockReset();
  });

  it("sendMail receives raw MIME built from outbound input", async () => {
    sendMail.mockResolvedValue({
      messageId: "<smtp-id@mailpit>",
    });

    const adapter = createSmtpAdapter({
      host: "localhost",
      port: 1025,
      fromAddress: "sender@example.com",
      fromName: "Sender",
      compliance,
    });

    const input: OutboundEmail = {
      from: { email: "sender@example.com", name: "Sender" },
      to: [{ email: "recipient@example.com" }],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    };

    const result = await adapter.send(input);
    expect(sendMail).toHaveBeenCalledOnce();
    const payload = sendMail.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload?.raw).toContain("Message-ID:");
    expect(payload?.raw).toContain("List-Unsubscribe:");
    expect(payload?.raw).toContain("Subject: Hello");
    expect(result.messageId).toMatch(/^</);
    expect(result.providerThreadId).toBeNull();
  });

  it("passes threading headers when anchor is provided", async () => {
    sendMail.mockResolvedValue({ messageId: "<thread@mailpit>" });

    const adapter = createSmtpAdapter({
      host: "localhost",
      port: 1025,
      fromAddress: "sender@example.com",
      compliance,
    });

    await adapter.send({
      from: { email: "sender@example.com" },
      to: [{ email: "recipient@example.com" }],
      subject: "Original",
      html: "<p>Follow</p>",
      text: "Follow",
      threading: {
        inReplyTo: "<anchor@example.com>",
        references: "<anchor@example.com>",
        subject: "Re: Original",
        providerThreadId: null,
      },
    });

    const raw = String(sendMail.mock.calls[0]?.[0]?.raw);
    expect(raw).toContain("In-Reply-To: <anchor@example.com>");
    expect(raw).toContain("References: <anchor@example.com>");
    expect(raw).toContain("Subject: Re: Original");
  });

  it("classifies EAUTH as auth SendError", async () => {
    sendMail.mockRejectedValue(Object.assign(new Error("Invalid login"), { code: "EAUTH" }));

    const adapter = createSmtpAdapter({
      host: "localhost",
      port: 1025,
      fromAddress: "sender@example.com",
      compliance,
    });

    await expect(
      adapter.send({
        from: { email: "sender@example.com" },
        to: [{ email: "r@example.com" }],
        subject: "x",
        html: "x",
        text: "x",
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof SendError && err.kind === "auth");
  });

  it("classifies ECONNREFUSED as transient SendError", async () => {
    sendMail.mockRejectedValue(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));

    const adapter = createSmtpAdapter({
      host: "localhost",
      port: 1025,
      fromAddress: "sender@example.com",
      compliance,
    });

    await expect(
      adapter.send({
        from: { email: "sender@example.com" },
        to: [{ email: "r@example.com" }],
        subject: "x",
        html: "x",
        text: "x",
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof SendError && err.kind === "transient");
  });
});

describe("sendMime", () => {
  it("normalizes message id from mime output", async () => {
    sendMail.mockResolvedValue({ messageId: "<UPPER@HOST>" });
    const transport = { sendMail } as never;
    const result = await sendMime(transport, {
      messageId: "<abc@quiksend.local>",
      subject: "Test",
      raw: "raw",
      headers: {},
    });
    expect(result.messageId).toBe("<abc@quiksend.local>");
  });
});
