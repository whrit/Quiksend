/**
 * Regression: real adapter wiring through createAdapterForMailbox must apply
 * compliance exactly once inside buildMime — not doubled by callers and not
 * replaced by placeholder fallbacks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComplianceInput } from "../compliance.ts";
import { createAdapterForMailbox } from "./index.ts";

const sendMail = vi.fn<(message: { raw?: string }) => Promise<{ messageId?: string }>>();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn<() => { sendMail: typeof sendMail }>(() => ({ sendMail })),
  },
}));

const compliance: ComplianceInput = {
  unsubscribeUrl: "https://app.quiksend.test/unsubscribe/real-token-xyz",
  senderPostalAddress: "123 Real Street, Austin, TX 78701",
  senderOrgName: "Acme Sales",
};

describe("createAdapterForMailbox compliance wiring", () => {
  afterEach(() => {
    sendMail.mockReset();
  });

  it("builds MIME with exactly one compliance footer and real unsubscribe URL", async () => {
    sendMail.mockResolvedValue({ messageId: "<smtp-id@mailpit>" });

    const adapter = createAdapterForMailbox(
      {
        provider: "smtp",
        nangoConnectionId: null,
        smtpConfig: {
          host: "localhost",
          port: 1025,
          secure: false,
        },
        address: "sender@example.com",
        fromName: "Sender",
      },
      compliance,
    );

    await adapter.send({
      from: { email: "sender@example.com", name: "Sender" },
      to: [{ email: "recipient@example.com" }],
      subject: "Hello",
      html: "<p>Hi there</p>",
      text: "Hi there",
    });

    expect(sendMail).toHaveBeenCalledOnce();
    const raw = String(sendMail.mock.calls[0]?.[0]?.raw);

    expect(raw).toContain(
      "List-Unsubscribe: <https://app.quiksend.test/unsubscribe/real-token-xyz>",
    );
    expect(raw).not.toContain("app.example.com");
    expect(raw).toContain("123 Real Street, Austin, TX 78701");
    expect(raw).toContain("Acme Sales");

    expect(raw.match(/List-Unsubscribe:/g)?.length).toBe(1);

    const postalMatches = raw.match(/123 Real Street, Austin, TX 78701/g) ?? [];
    expect(postalMatches.length).toBe(2);

    const orgMatches = raw.match(/Acme Sales/g) ?? [];
    expect(orgMatches.length).toBe(2);

    const unsubscribeUrlMatches =
      raw.match(/https:\/\/app\.quiksend\.test\/unsubscribe\/real-token-xyz/g) ?? [];
    expect(unsubscribeUrlMatches.length).toBe(3);
  });
});
