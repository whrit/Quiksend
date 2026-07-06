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
import { normalizeMessageId, type ThreadingHeaders } from "../threading.ts";
import type { NangoProxyClient } from "../nango-proxy.ts";

const MICROSOFT_PROVIDER_KEY = "microsoft";

export interface MicrosoftAdapterConfig {
  readonly nangoConnectionId: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly compliance?: ComplianceInput;
  readonly nango: NangoProxyClient;
}

interface GraphMessageSummary {
  readonly id: string;
  readonly internetMessageId?: string;
  readonly conversationId?: string;
}

interface GraphListResponse {
  readonly value?: readonly GraphMessageSummary[];
}

export function createMicrosoftAdapter(config: MicrosoftAdapterConfig): MailboxAdapter {
  const nango = config.nango;

  const from: EmailAddress = {
    email: config.fromAddress,
    name: config.fromName,
  };
  const compliance = config.compliance ?? minimalCompliance();

  return {
    provider: "microsoft",
    async send(input: OutboundEmail): Promise<SendResult> {
      const mime = buildMimeFromOutbound(input, from, compliance);
      const rawMime = encodeBase64(mime.raw);

      try {
        await nango.post({
          endpoint: "/v1.0/me/sendMail",
          providerConfigKey: MICROSOFT_PROVIDER_KEY,
          connectionId: config.nangoConnectionId,
          headers: { "Content-Type": "text/plain" },
          data: rawMime,
        });
      } catch (err) {
        throw classifyMicrosoftError(err);
      }

      const sent = await findSentMessage(nango, config.nangoConnectionId, mime.messageId);
      if (!sent) {
        throw new SendError(
          "transient",
          "Message sent but could not resolve Graph message id from Sent Items",
          null,
        );
      }

      let detail: GraphMessageSummary;
      try {
        const response = await nango.get({
          endpoint: `/v1.0/me/messages/${sent.id}`,
          providerConfigKey: MICROSOFT_PROVIDER_KEY,
          connectionId: config.nangoConnectionId,
          params: { $select: "internetMessageId,conversationId" },
        });
        detail = response.data as GraphMessageSummary;
      } catch (err) {
        throw classifyMicrosoftError(err);
      }

      const messageId = normalizeMessageId(detail.internetMessageId ?? mime.messageId);

      return {
        messageId,
        providerMessageId: sent.id,
        providerThreadId: detail.conversationId ?? sent.conversationId ?? null,
        sentAt: new Date(),
      };
    },
    async listInbound(): Promise<[]> {
      // Intentional no-op. Microsoft 365 inbound polling is implemented in
      // `apps/worker/src/handlers/mailbox-poll.ts:pollMicrosoft`, which calls
      // the Graph delta endpoint through Nango — bypassing this per-adapter
      // method because it needs the workspace's poll cursor + threading
      // writeback. Kept on the interface so a future in-process consumer
      // (e.g. an SSR preview) has a symmetric read path.
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

async function findSentMessage(
  nango: NangoProxyClient,
  connectionId: string,
  internetMessageId: string,
): Promise<GraphMessageSummary | null> {
  const filterId = internetMessageId.replace(/'/g, "''");
  const response = await nango.get({
    endpoint: "/v1.0/me/mailFolders/sentitems/messages",
    providerConfigKey: MICROSOFT_PROVIDER_KEY,
    connectionId,
    params: {
      $filter: `internetMessageId eq '${filterId}'`,
      $select: "id,internetMessageId,conversationId",
      $top: "1",
    },
  });
  const data = response.data as GraphListResponse;
  return data.value?.[0] ?? null;
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

function encodeBase64(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64");
}

function minimalCompliance(): ComplianceInput {
  return {
    unsubscribeUrl: "https://app.example.com/u/pending",
    senderPostalAddress: "1 Main St, City",
    senderOrgName: "Quiksend",
  };
}

function classifyMicrosoftError(err: unknown): SendError {
  const axiosErr = err as {
    response?: {
      status?: number;
      data?: { error?: { code?: string; message?: string } };
    };
    message?: string;
  };
  const status = axiosErr.response?.status;
  const providerCode = axiosErr.response?.data?.error?.code ?? null;
  const message =
    axiosErr.response?.data?.error?.message ?? axiosErr.message ?? "Microsoft Graph send failed";

  if (status === 401 || providerCode === "InvalidAuthenticationToken") {
    return new SendError("auth", message, providerCode);
  }
  if (status === 429 || providerCode === "TooManyRequests") {
    return new SendError("quota", message, providerCode);
  }
  if (status !== undefined && status >= 500) {
    return new SendError("transient", message, providerCode);
  }
  if ((status === 400 || status === 422) && isInvalidRecipient(message)) {
    return new SendError("permanent", message, providerCode);
  }
  if (status === 400 || status === 422) {
    return new SendError("permanent", message, providerCode);
  }
  return new SendError("transient", message, providerCode);
}

function isInvalidRecipient(message: string): boolean {
  return /invalid recipient|recipient address|mailbox not found|does not exist/i.test(message);
}
