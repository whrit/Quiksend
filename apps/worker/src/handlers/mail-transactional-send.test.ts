/**
 * Unit tests for the `mail.send_transactional` job handler — the worker-side
 * consumer of `packages/auth/src/auth.ts`'s durable enqueue. Mocks
 * `sendTransactionalEmail` so no real SMTP relay is touched.
 */
import { describe, expect, it, vi } from "vitest";

const sendTransactionalEmailMock = vi.hoisted(() =>
  vi.fn<(input: { to: string; subject: string; text: string; html: string }) => Promise<void>>(),
);

vi.mock("@quiksend/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/mail")>();
  return { ...actual, sendTransactionalEmail: sendTransactionalEmailMock };
});

import { handleMailSendTransactional } from "./mail-transactional-send.ts";

const payload = {
  to: "invitee@example.com",
  subject: "You're invited to join Acme on Quiksend",
  text: "plain body",
  html: "<p>html body</p>",
};

describe("handleMailSendTransactional", () => {
  it("sends the payload as-is via sendTransactionalEmail", async () => {
    sendTransactionalEmailMock.mockResolvedValueOnce(undefined);
    await handleMailSendTransactional(payload);
    expect(sendTransactionalEmailMock).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("propagates a send failure instead of swallowing it — pg-boss only retries a job whose handler rejects", async () => {
    sendTransactionalEmailMock.mockRejectedValueOnce(new Error("relay unreachable"));
    await expect(handleMailSendTransactional(payload)).rejects.toThrow("relay unreachable");
  });
});
