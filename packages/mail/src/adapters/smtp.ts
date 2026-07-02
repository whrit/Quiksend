import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
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
import { buildMime, type BuildMimeInput, type BuildMimeOutput } from "../mime.ts";
import { normalizeMessageId, type ThreadingHeaders } from "../threading.ts";

export interface SmtpAdapterConfig {
  readonly host: string;
  readonly port: number;
  readonly auth?: { readonly user: string; readonly pass: string };
  readonly secure?: boolean;
  readonly fromAddress: string;
  readonly fromName?: string;
  /** Used when `send()` builds MIME internally (e.g. test sends). */
  readonly compliance?: ComplianceInput;
  /** Inject for tests. */
  readonly transport?: Transporter;
}

export function createSmtpAdapter(config: SmtpAdapterConfig): MailboxAdapter {
  const transport =
    config.transport ??
    nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? false,
      auth: config.auth,
    });

  const from: EmailAddress = {
    email: config.fromAddress,
    name: config.fromName,
  };

  return {
    provider: "smtp",
    async send(input: OutboundEmail): Promise<SendResult> {
      const compliance = config.compliance ?? minimalCompliance();
      const mime = buildMimeFromOutbound(input, from, compliance);
      return sendMime(transport, mime, {
        from: from.email,
        to: input.to.map((t) => t.email),
      });
    },
    async listInbound(): Promise<never> {
      throw new Error(
        "listInbound is not implemented for SMTP-out-only adapter; IMAP polling lands in Phase 7",
      );
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

/** Send a pre-built MIME payload (used by compose after compliance + threading). */
export async function sendMime(
  transport: Transporter,
  mime: BuildMimeOutput,
  envelope?: { from: string; to: string[] },
): Promise<SendResult> {
  try {
    const info = await transport.sendMail({
      raw: mime.raw,
      ...(envelope ? { envelope } : {}),
    });
    const providerMessageId = info.messageId ?? mime.messageId;
    return {
      messageId: normalizeMessageId(mime.messageId),
      providerMessageId,
      providerThreadId: null,
      sentAt: new Date(),
    };
  } catch (err) {
    throw classifyNodemailerError(err);
  }
}

export function createSmtpTransport(config: SmtpAdapterConfig): Transporter {
  return (
    config.transport ??
    nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? false,
      auth: config.auth,
    })
  );
}

function buildMimeFromOutbound(
  input: OutboundEmail,
  from: EmailAddress,
  compliance: ComplianceInput,
): BuildMimeOutput {
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

function minimalCompliance(): ComplianceInput {
  return {
    unsubscribeUrl: "https://app.example.com/u/pending",
    senderPostalAddress: "1 Main St, City",
    senderOrgName: "Quiksend",
  };
}

function classifyNodemailerError(err: unknown): SendError {
  if (err && typeof err === "object") {
    const code = "code" in err ? String(err.code) : null;
    const message = "message" in err ? String(err.message) : "Send failed";
    const responseCode =
      "responseCode" in err && typeof err.responseCode === "number" ? err.responseCode : null;

    if (code === "EAUTH" || code === "EOAUTH2") {
      return new SendError("auth", message, code);
    }
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ESOCKET") {
      return new SendError("transient", message, code);
    }
    if (responseCode !== null && responseCode >= 500) {
      const kind = isPermanentSmtpFailure(message, responseCode) ? "permanent" : "transient";
      return new SendError(kind, message, String(responseCode));
    }
    if (responseCode !== null && responseCode >= 400) {
      return new SendError("permanent", message, String(responseCode));
    }
  }
  return new SendError("transient", err instanceof Error ? err.message : "Send failed", null);
}

function isPermanentSmtpFailure(message: string, responseCode: number): boolean {
  if (responseCode === 550 || responseCode === 551 || responseCode === 553) return true;
  return /user unknown|mailbox unavailable|invalid recipient|does not exist/i.test(message);
}
