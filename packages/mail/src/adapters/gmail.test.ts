import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComplianceInput } from "../compliance.ts";
import type { OutboundEmail } from "../adapter.ts";
import { SendError } from "../adapter.ts";
import type { NangoProxyClient } from "../nango-proxy.ts";
import { createGmailAdapter } from "./gmail.ts";

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

describe("createGmailAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds MIME, base64url-encodes, sends, and fetches Message-Id", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockResolvedValue({
      data: { id: "gmail-msg-1", threadId: "thread-abc" },
      status: 200,
    });
    const get = vi.fn<NangoProxyClient["get"]>().mockResolvedValue({
      data: {
        payload: {
          headers: [{ name: "Message-Id", value: "<provider-msg@google.com>" }],
        },
      },
      status: 200,
    });

    const adapter = createGmailAdapter({
      nangoConnectionId: "conn-1",
      fromAddress: "sender@example.com",
      fromName: "Sender",
      compliance,
      nango: createMockNango({ post, get }),
    });

    const input: OutboundEmail = {
      from: { email: "sender@example.com", name: "Sender" },
      to: [{ email: "recipient@example.com" }],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    };

    const result = await adapter.send(input);

    expect(post).toHaveBeenCalledOnce();
    const postCall = post.mock.calls[0]?.[0];
    expect(postCall?.endpoint).toBe("/gmail/v1/users/me/messages/send");
    expect(postCall?.providerConfigKey).toBe("google-mail");
    expect(postCall?.connectionId).toBe("conn-1");
    expect(postCall?.data).toMatchObject({ raw: expect.any(String) });
    const payload = postCall?.data as { raw?: string };
    expect(String(payload.raw)).not.toContain("+");
    expect(String(payload.raw)).not.toContain("/");

    expect(get).toHaveBeenCalledOnce();
    expect(get.mock.calls[0]?.[0]?.endpoint).toBe("/gmail/v1/users/me/messages/gmail-msg-1");

    expect(result.messageId).toBe("<provider-msg@google.com>");
    expect(result.providerMessageId).toBe("gmail-msg-1");
    expect(result.providerThreadId).toBe("thread-abc");
  });

  it("includes threadId when anchor providerThreadId is set", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockResolvedValue({
      data: { id: "gmail-msg-2", threadId: "thread-xyz" },
      status: 200,
    });
    const get = vi.fn<NangoProxyClient["get"]>().mockResolvedValue({
      data: { payload: { headers: [{ name: "Message-Id", value: "<t@google.com>" }] } },
      status: 200,
    });

    const adapter = createGmailAdapter({
      nangoConnectionId: "conn-1",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post, get }),
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
        providerThreadId: "thread-xyz",
      },
    });

    expect(post.mock.calls[0]?.[0]?.data).toMatchObject({ threadId: "thread-xyz" });
  });

  it("maps 401/403 to auth SendError", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockRejectedValue({
      response: { status: 401, data: { error: { message: "Unauthorized" } } },
    });
    const adapter = createGmailAdapter({
      nangoConnectionId: "conn-1",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post }),
    });

    await expect(sendMinimal(adapter)).rejects.toSatisfy(
      (err: unknown) => err instanceof SendError && err.kind === "auth",
    );
  });

  it("maps 429 and RATE_LIMIT_EXCEEDED to quota SendError", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockRejectedValue({
      response: {
        status: 429,
        data: { error: { message: "Rate exceeded", errors: [{ reason: "RATE_LIMIT_EXCEEDED" }] } },
      },
    });
    const adapter = createGmailAdapter({
      nangoConnectionId: "conn-1",
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
      response: { status: 503, data: { error: { message: "Backend error" } } },
    });
    const adapter = createGmailAdapter({
      nangoConnectionId: "conn-1",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post }),
    });

    await expect(sendMinimal(adapter)).rejects.toSatisfy(
      (err: unknown) => err instanceof SendError && err.kind === "transient",
    );
  });

  it("maps 400 invalid recipient to permanent SendError", async () => {
    const post = vi.fn<NangoProxyClient["post"]>().mockRejectedValue({
      response: { status: 400, data: { error: { message: "Invalid recipient address" } } },
    });
    const adapter = createGmailAdapter({
      nangoConnectionId: "conn-1",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({ post }),
    });

    await expect(sendMinimal(adapter)).rejects.toSatisfy(
      (err: unknown) => err instanceof SendError && err.kind === "permanent",
    );
  });

  it("listInbound returns empty array without throwing", async () => {
    const adapter = createGmailAdapter({
      nangoConnectionId: "conn-1",
      fromAddress: "sender@example.com",
      compliance,
      nango: createMockNango({}),
    });
    await expect(adapter.listInbound(new Date())).resolves.toEqual([]);
  });
});

async function sendMinimal(adapter: ReturnType<typeof createGmailAdapter>): Promise<void> {
  await adapter.send({
    from: { email: "sender@example.com" },
    to: [{ email: "r@example.com" }],
    subject: "x",
    html: "x",
    text: "x",
  });
}
