import type { ComplianceInput } from "../compliance.ts";
import type {
  EmailAddress,
  IdentityHealth,
  MailboxAdapter,
  OutboundEmail,
  SendResult,
} from "../adapter.ts";
import { SendError } from "../adapter.ts";
import { checkDomainAuth } from "../dns.ts";
import { buildMime, type BuildMimeInput } from "../mime.ts";
import type { NangoProxyClient } from "../nango-proxy.ts";
import { normalizeMessageId, type ThreadingHeaders } from "../threading.ts";

const GMAIL_PROVIDER_KEY = "google-mail";

export interface GmailAdapterConfig {
  readonly nangoConnectionId: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly compliance?: ComplianceInput;
  readonly nango: NangoProxyClient;
}

interface GmailSendResponse {
  readonly id: string;
  readonly threadId: string;
}

interface GmailMessageMetadata {
  readonly payload?: {
    readonly headers?: readonly { readonly name: string; readonly value: string }[];
  };
}

export function createGmailAdapter(config: GmailAdapterConfig): MailboxAdapter {
  const nango = config.nango;

  const from: EmailAddress = {
    email: config.fromAddress,
    name: config.fromName,
  };
  const compliance = config.compliance ?? minimalCompliance();

  return {
    provider: "gmail",
    async send(input: OutboundEmail): Promise<SendResult> {
      const mime = buildMimeFromOutbound(input, from, compliance);
      const raw = encodeBase64Url(mime.raw);
      const payload: { raw: string; threadId?: string } = { raw };
      const threadId = input.threading?.providerThreadId;
      if (threadId) payload.threadId = threadId;

      let sendResponse: { data: unknown; status: number };
      try {
        sendResponse = await nango.post({
          endpoint: "/gmail/v1/users/me/messages/send",
          providerConfigKey: GMAIL_PROVIDER_KEY,
          connectionId: config.nangoConnectionId,
          data: payload,
        });
      } catch (err) {
        throw classifyGmailError(err);
      }

      const sendData = sendResponse.data as GmailSendResponse;
      const providerMessageId = sendData.id;
      const providerThreadId = sendData.threadId ?? null;

      let metadataResponse: { data: unknown; status: number };
      try {
        metadataResponse = await nango.get({
          endpoint: `/gmail/v1/users/me/messages/${providerMessageId}`,
          providerConfigKey: GMAIL_PROVIDER_KEY,
          connectionId: config.nangoConnectionId,
          params: {
            format: "metadata",
            metadataHeaders: "Message-Id",
          },
        });
      } catch (err) {
        throw classifyGmailError(err);
      }

      const metadata = metadataResponse.data as GmailMessageMetadata;
      const headerValue = metadata.payload?.headers?.find(
        (h) => h.name.toLowerCase() === "message-id",
      )?.value;
      const messageId = normalizeMessageId(headerValue ?? mime.messageId);

      return {
        messageId,
        providerMessageId,
        providerThreadId,
        sentAt: new Date(),
      };
    },
    async listInbound(): Promise<[]> {
      // history-based polling wired in Phase 7 R-070
      return [];
    },
    async verifyIdentity(): Promise<IdentityHealth> {
      const domain = config.fromAddress.split("@")[1] ?? config.fromAddress;
      const auth = await checkDomainAuth(domain);
      return {
        domain,
        spf: { pass: auth.spf.pass, reason: auth.spf.reason },
        dkim: { pass: auth.dkim.pass, reason: auth.dkim.reason },
        dmarc: { pass: auth.dmarc.pass, reason: auth.dmarc.reason },
        checkedAt: new Date(),
      };
    },
  };
}

function buildMimeFromOutbound(
  input: OutboundEmail,
  from: EmailAddress,
  compliance: ComplianceInput,
): ReturnType<typeof buildMime> {
  const buildInput: BuildMimeInput = {
    from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    replyTo: input.replyTo,
    subject: input.subject,
    html: input.html,
    text: input.text,
    compliance,
    extraHeaders: input.extraHeaders,
    anchor: threadingToAnchor(input.threading, input.subject),
  };
  return buildMime(buildInput);
}

function threadingToAnchor(
  threading: ThreadingHeaders | undefined,
  fallbackSubject: string,
): BuildMimeInput["anchor"] {
  if (!threading) return undefined;
  return {
    messageId: threading.inReplyTo,
    subject: threading.subject || fallbackSubject,
    providerThreadId: threading.providerThreadId,
    priorReferences: threading.references.split(/\s+/).filter(Boolean),
  };
}

function encodeBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function minimalCompliance(): ComplianceInput {
  return {
    unsubscribeUrl: "https://app.example.com/u/pending",
    senderPostalAddress: "1 Main St, City",
    senderOrgName: "Quiksend",
  };
}

function classifyGmailError(err: unknown): SendError {
  const axiosErr = err as {
    response?: {
      status?: number;
      data?: { error?: { message?: string; errors?: { reason?: string }[] } };
    };
    message?: string;
  };
  const status = axiosErr.response?.status;
  const providerCode =
    axiosErr.response?.data?.error?.errors?.[0]?.reason ??
    axiosErr.response?.data?.error?.message ??
    null;
  const message =
    axiosErr.response?.data?.error?.message ?? axiosErr.message ?? "Gmail send failed";

  if (status === 401 || status === 403) {
    return new SendError("auth", message, providerCode);
  }
  if (status === 429 || providerCode === "RATE_LIMIT_EXCEEDED") {
    return new SendError("quota", message, providerCode);
  }
  if (status !== undefined && status >= 500) {
    return new SendError("transient", message, providerCode);
  }
  if (status === 400 && isInvalidRecipient(message)) {
    return new SendError("permanent", message, providerCode);
  }
  if (status !== undefined && status >= 400) {
    return new SendError("permanent", message, providerCode);
  }
  return new SendError("transient", message, providerCode);
}

function isInvalidRecipient(message: string): boolean {
  return /invalid recipient|recipient address required|mailbox not found|user unknown/i.test(
    message,
  );
}
