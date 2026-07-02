/**
 * Microsoft Graph adapter unit tests mock the Nango proxy client rather than
 * `createFakeAdapter`. These cases cover Graph-specific send/reply semantics
 * (conversationId threading, draft creation, attachment of threading headers).
 * Engine integration tests should use `createFakeAdapter` when provider I/O is
 * not the subject under test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComplianceInput } from "../compliance.ts";
import type { OutboundEmail } from "../adapter.ts";
import { SendError } from "../adapter.ts";
import { createMicrosoftAdapter } from "./microsoft.ts";
import type { NangoProxyClient } from "../nango-proxy.ts";

const compliance: ComplianceInput = {
  unsubscribeUrl: "https://app.example.com/u/pending",
  senderPostalAddress: "1 Main St",
  senderOrgName: "Acme",
};

function createMockNango(handlers: {
  post?: NangoProxyClient["post"];
  get?: NangoProxyClient["get"];
}): NangoProxyClient {
  return {
    post: handlers.post ?? vi.fn<NangoProxyClient["post"]>(),
    get: handlers.get ?? vi.fn<NangoProxyClient["get"]>(),
  };
}

describe("createMicrosoftAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends base64 MIME via sendMail and resolves Message-Id from sent items", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockResolvedValue({ data: null, status: 202 });
    const get = vi
      .fn<NangoProxyClient["get"]>()
      .mockResolvedValueOnce({
        data: {
          value: [
            {
              id: "graph-msg-1",
              internetMessageId: "<graph-msg@outlook.com>",
              conversationId: "conv-1",
            },
          ],
        },
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          id: "graph-msg-1",
          internetMessageId: "<graph-msg@outlook.com>",
          conversationId: "conv-1",
        },
        status: 200,
      });

    const adapter = createMicrosoftAdapter({
      nangoConnectionId: "conn-ms",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post, get }),
    });

    const input: OutboundEmail = {
      from: { email: "sender@example.com" },
      to: [{ email: "recipient@example.com" }],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    };

    const result = await adapter.send(input);

    expect(post).toHaveBeenCalledOnce();
    const postCall = post.mock.calls[0]?.[0];
    expect(postCall?.endpoint).toBe("/v1.0/me/sendMail");
    expect(postCall?.headers).toEqual({ "Content-Type": "text/plain" });
    expect(typeof postCall?.data).toBe("string");

    expect(get).toHaveBeenCalledTimes(2);
    expect(result.messageId).toBe("<graph-msg@outlook.com>");
    expect(result.providerMessageId).toBe("graph-msg-1");
    expect(result.providerThreadId).toBe("conv-1");
  });

  it("maps 401 and InvalidAuthenticationToken to auth SendError", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockRejectedValue({
      response: {
        status: 401,
        data: { error: { code: "InvalidAuthenticationToken", message: "Token expired" } },
      },
    });
    const adapter = createMicrosoftAdapter({
      nangoConnectionId: "conn-ms",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post }),
    });

    await expect(sendMinimal(adapter)).rejects.toSatisfy(
      (err: unknown) => err instanceof SendError && err.kind === "auth",
    );
  });

  it("maps 429 and TooManyRequests to quota SendError", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockRejectedValue({
      response: {
        status: 429,
        data: { error: { code: "TooManyRequests", message: "Throttled" } },
      },
    });
    const adapter = createMicrosoftAdapter({
      nangoConnectionId: "conn-ms",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post }),
    });

    await expect(sendMinimal(adapter)).rejects.toSatisfy(
      (err: unknown) => err instanceof SendError && err.kind === "quota",
    );
  });

  it("maps 5xx to transient SendError", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockRejectedValue({
      response: { status: 502, data: { error: { code: "BadGateway", message: "Upstream" } } },
    });
    const adapter = createMicrosoftAdapter({
      nangoConnectionId: "conn-ms",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post }),
    });

    await expect(sendMinimal(adapter)).rejects.toSatisfy(
      (err: unknown) => err instanceof SendError && err.kind === "transient",
    );
  });

  it("maps 400 recipient errors to permanent SendError", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockRejectedValue({
      response: {
        status: 400,
        data: { error: { code: "ErrorInvalidRecipients", message: "Invalid recipient address" } },
      },
    });
    const adapter = createMicrosoftAdapter({
      nangoConnectionId: "conn-ms",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post }),
    });

    await expect(sendMinimal(adapter)).rejects.toSatisfy(
      (err: unknown) => err instanceof SendError && err.kind === "permanent",
    );
  });

  it("listInbound returns empty array without throwing", async () => {
    const adapter = createMicrosoftAdapter({
      nangoConnectionId: "conn-ms",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({}),
    });
    await expect(adapter.listInbound(new Date())).resolves.toEqual([]);
  });
});

async function sendMinimal(adapter: ReturnType<typeof createMicrosoftAdapter>): Promise<void> {
  await adapter.send({
    from: { email: "sender@example.com" },
    to: [{ email: "r@example.com" }],
    subject: "x",
    html: "x",
    text: "x",
  });
}
