/**
 * `sendTransactionalEmail` mocks nodemailer the same way `adapters/smtp.test.ts`
 * does — it's the same nodemailer contract, just without the MIME/compliance
 * pipeline. The interesting behaviors here are the *lazy* transport (never
 * connects until a send is attempted, throws instead of silently swallowing
 * a missing relay) and that it's a thin passthrough to `sendMail`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => ({
  sendMail: vi.fn<(message: unknown) => Promise<{ messageId?: string }>>(),
  createTransport: vi.fn<() => { sendMail: unknown }>(),
}));
createTransport.mockImplementation(() => ({ sendMail }));

vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { SMTP_HOST: undefined as string | undefined, SMTP_PORT: undefined as number | undefined },
}));

vi.mock("@quiksend/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/config")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get SMTP_HOST() {
        return mockEnv.SMTP_HOST;
      },
      get SMTP_PORT() {
        return mockEnv.SMTP_PORT;
      },
    },
  };
});

const { sendTransactionalEmail } = await import("./transactional.ts");

describe("sendTransactionalEmail", () => {
  beforeEach(() => {
    mockEnv.SMTP_HOST = "localhost";
    mockEnv.SMTP_PORT = 1025;
    sendMail.mockResolvedValue({ messageId: "<id@relay>" });
  });

  afterEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it("throws instead of silently sending when no transactional SMTP relay is configured — proves the transport is lazy, not eagerly built", async () => {
    mockEnv.SMTP_HOST = undefined;
    await expect(
      sendTransactionalEmail({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
    ).rejects.toThrow(/SMTP_HOST/);
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends via the operator relay (never a customer mailbox) and memoizes the transport across calls", async () => {
    await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Reset your password",
      text: "plain body",
      html: "<p>html body</p>",
    });
    await sendTransactionalEmail({
      to: "second@example.com",
      subject: "Reset your password",
      text: "plain body",
      html: "<p>html body</p>",
    });
    expect(createTransport).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ host: "localhost", port: 1025, secure: false }),
    );
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: "user@example.com",
        subject: "Reset your password",
        text: "plain body",
        html: "<p>html body</p>",
      }),
    );
  });
});
