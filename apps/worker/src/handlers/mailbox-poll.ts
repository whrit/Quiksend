import { env, logger } from "@quiksend/config";
import { classifyInboundSentiment } from "@quiksend/ai";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getNango } from "@quiksend/integrations";
import { detectAutoReply, matchInbound, parseBounce, type OutboundAnchor } from "@quiksend/mail";
import { decryptSmtpConfig } from "@quiksend/mail";
import { normalizeMessageId } from "@quiksend/mail/threading";
import { enqueue, getBoss, registerHandler } from "@quiksend/queue";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  handleInboundBounce,
  handleInboundReply,
  type InboundEmail,
} from "../sequence/inbound-handler.ts";
import {
  dedupeGraphMessages,
  filterMessagesSince,
  graphEndpointFromDeltaLink,
  MS_DELTA_PAGE_CAP,
  type GraphDeltaPage,
} from "./microsoft-delta.ts";

const GMAIL_PROVIDER_KEY = "google-mail";
const MS_PROVIDER_KEY = "microsoft";

interface PollCursor {
  gmailHistoryId?: string;
  microsoftDeltaLink?: string;
  imapLastUid?: number;
  lastPolledAt?: string;
}

interface ParsedInbound {
  providerMessageId: string;
  providerThreadId: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string | null;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  fromEmail: string | null;
  rawMime: string;
  receivedAt: Date;
  headers: Record<string, string>;
  bounceType: "hard" | "soft" | null;
}

interface OrgInboxSettings {
  stop_on_ooo: boolean;
}

export async function registerMailboxPollHandler(): Promise<void> {
  await registerHandler("mailbox.poll", async ({ mailboxId, since }) => {
    await pollMailbox(mailboxId, new Date(since));
  });
}

const MAILBOX_POLL_STAGGER_BUCKETS = 4;
const MAILBOX_POLL_STAGGER_SECONDS = 30;

function mailboxPollBucket(mailboxId: string): number {
  let hash = 0;
  for (let i = 0; i < mailboxId.length; i++) {
    hash = (hash * 31 + mailboxId.charCodeAt(i)) >>> 0;
  }
  return hash % MAILBOX_POLL_STAGGER_BUCKETS;
}

export async function registerMailboxPollTick(): Promise<void> {
  // Order matters: `registerHandler` internally calls `boss.createQueue`, which
  // inserts the row into `pgboss.queue`. `boss.schedule` inserts into
  // `pgboss.schedule` with an FK back to `pgboss.queue.name` — scheduling
  // before the queue exists throws `Queue mailbox.poll.tick not found`.
  await registerHandler("mailbox.poll.tick", async () => {
    const mailboxes = await db.query.mailbox.findMany({
      where: and(eq(tables.mailbox.status, "active"), isNotNull(tables.mailbox.address)),
    });
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    for (const mailbox of mailboxes) {
      const bucket = mailboxPollBucket(mailbox.id);
      const startAfter = bucket * MAILBOX_POLL_STAGGER_SECONDS;
      await enqueue("mailbox.poll", { mailboxId: mailbox.id, since }, { startAfter });
    }
    logger.debug({ count: mailboxes.length }, "mailbox.poll.tick enqueued mailboxes");
  });
  const boss = await getBoss();
  await boss.schedule("mailbox.poll.tick", "*/2 * * * *", {}, { tz: "UTC" });
  logger.info({ job: "mailbox.poll.tick" }, "mailbox poll tick scheduled");
}

async function pollMailbox(mailboxId: string, since: Date): Promise<void> {
  const mailbox = await db.query.mailbox.findFirst({
    where: eq(tables.mailbox.id, mailboxId),
  });
  if (!mailbox || mailbox.status !== "active") return;

  const cursor = parsePollCursor(mailbox.pollCursor);
  let inboundMessages: ParsedInbound[] = [];
  let nextCursor = cursor;

  try {
    switch (mailbox.provider) {
      case "gmail":
        ({ messages: inboundMessages, cursor: nextCursor } = await pollGmail(
          mailbox,
          cursor,
          since,
        ));
        break;
      case "microsoft":
        ({ messages: inboundMessages, cursor: nextCursor } = await pollMicrosoft(
          mailbox,
          cursor,
          since,
        ));
        break;
      case "smtp":
        ({ messages: inboundMessages, cursor: nextCursor } = await pollImap(
          mailbox,
          cursor,
          since,
        ));
        break;
      default:
        logger.warn({ mailboxId, provider: mailbox.provider }, "unknown mailbox provider");
        return;
    }
  } catch (err) {
    logger.error({ err, mailboxId }, "mailbox poll failed");
    throw err;
  }

  const orgSettings = await loadOrgInboxSettings(mailbox.organizationId);

  for (const inbound of inboundMessages) {
    try {
      await processInboundMessage(mailbox, inbound, orgSettings);
    } catch (err) {
      logger.error(
        { err, mailboxId, providerMessageId: inbound.providerMessageId },
        "inbound process failed",
      );
    }
  }

  nextCursor = { ...nextCursor, lastPolledAt: new Date().toISOString() };
  await db
    .update(tables.mailbox)
    .set({ pollCursor: nextCursor })
    .where(
      and(
        eq(tables.mailbox.id, mailboxId),
        eq(tables.mailbox.organizationId, mailbox.organizationId),
      ),
    );
}

async function processInboundMessage(
  mailbox: typeof tables.mailbox.$inferSelect,
  inbound: ParsedInbound,
  orgSettings: OrgInboxSettings,
): Promise<void> {
  const existing = await db.query.message.findFirst({
    where: and(
      eq(tables.message.organizationId, mailbox.organizationId),
      eq(tables.message.providerMessageId, inbound.providerMessageId),
      eq(tables.message.mailboxId, mailbox.id),
    ),
  });
  if (existing) return;

  const bounce = parseBounce(inbound.rawMime);
  const isBounce = bounce !== null;

  const outboundRows = await db.query.message.findMany({
    where: and(
      eq(tables.message.organizationId, mailbox.organizationId),
      eq(tables.message.direction, "outbound"),
      isNotNull(tables.message.messageIdHeader),
    ),
    orderBy: desc(tables.message.sentAt),
    limit: 500,
  });

  const anchors: OutboundAnchor[] = outboundRows
    .filter((row) => row.messageIdHeader)
    .map((row) => ({
      messageIdHeader: row.messageIdHeader!,
      providerThreadId: row.providerThreadId,
      subject: row.subject,
    }));

  const match = matchInbound(
    {
      inReplyTo: inbound.inReplyTo,
      references: inbound.references,
      providerThreadId: inbound.providerThreadId,
      subject: inbound.subject,
    },
    anchors,
  );

  const matchedOutbound = match
    ? outboundRows.find((row) => {
        if (!row.messageIdHeader) return false;
        try {
          return normalizeMessageId(row.messageIdHeader) === match.outboundMessageIdHeader;
        } catch {
          return row.messageIdHeader === match.outboundMessageIdHeader;
        }
      })
    : null;

  let messageIdHeader = inbound.messageIdHeader;
  if (messageIdHeader) {
    try {
      messageIdHeader = normalizeMessageId(messageIdHeader);
    } catch {
      // keep raw
    }
  }

  let inReplyTo = inbound.inReplyTo;
  if (inReplyTo) {
    try {
      inReplyTo = normalizeMessageId(inReplyTo);
    } catch {
      // keep raw
    }
  }

  const [inserted] = await db
    .insert(tables.message)
    .values({
      organizationId: mailbox.organizationId,
      mailboxId: mailbox.id,
      prospectId: matchedOutbound?.prospectId ?? null,
      enrollmentId: matchedOutbound?.enrollmentId ?? null,
      direction: "inbound",
      subject: inbound.subject,
      bodyHtml: inbound.bodyHtml,
      bodyText: inbound.bodyText,
      messageIdHeader,
      providerMessageId: inbound.providerMessageId,
      providerThreadId: inbound.providerThreadId ?? matchedOutbound?.providerThreadId ?? null,
      inReplyTo,
      referencesHeader: inbound.references,
      status: "received",
      bounceType: isBounce ? (bounce?.type ?? "hard") : null,
      dsn: isBounce ? bounce : null,
      receivedAt: inbound.receivedAt,
    })
    .returning();

  if (!inserted) return;

  if (!isBounce) {
    await storeInboundSentiment(inserted.id, {
      subject: inbound.subject,
      bodyText: inbound.bodyText,
      bodyHtml: inbound.bodyHtml,
    });
  }

  const inboundEmail: InboundEmail = {
    id: inserted.id,
    organizationId: mailbox.organizationId,
    mailboxId: mailbox.id,
    providerMessageId: inbound.providerMessageId,
    providerThreadId: inserted.providerThreadId,
    messageIdHeader,
    inReplyTo,
    references: inbound.references,
    subject: inbound.subject,
    bodyHtml: inbound.bodyHtml,
    bodyText: inbound.bodyText,
    fromEmail: inbound.fromEmail,
    bounceType: isBounce ? (bounce?.type ?? "hard") : null,
    receivedAt: inbound.receivedAt,
    enrollmentId: matchedOutbound?.enrollmentId ?? null,
  };

  if (isBounce && matchedOutbound?.enrollmentId) {
    const recipient = bounce?.recipient ?? inbound.fromEmail;
    await handleInboundBounce(
      { ...inboundEmail, fromEmail: recipient, bounceType: bounce?.type ?? "hard" },
      matchedOutbound.enrollmentId,
    );
    return;
  }

  if (isBounce) return;

  const autoReply = detectAutoReply(inbound.headers, inbound.bodyText);
  if (autoReply.isAutoReply && !orgSettings.stop_on_ooo) {
    logger.info(
      { messageId: inserted.id, reason: autoReply.reason },
      "auto-reply detected; not stopping enrollment",
    );
    return;
  }

  if (matchedOutbound?.enrollmentId) {
    await handleInboundReply(inboundEmail, matchedOutbound.enrollmentId);
  }
}

async function storeInboundSentiment(
  messageId: string,
  inbound: { subject: string | null; bodyText: string | null; bodyHtml: string | null },
): Promise<void> {
  const sentiment = await classifyInboundSentiment(inbound);
  if (!sentiment) return;
  await db.update(tables.message).set({ sentiment }).where(eq(tables.message.id, messageId));
}

async function pollGmail(
  mailbox: typeof tables.mailbox.$inferSelect,
  cursor: PollCursor,
  since: Date,
): Promise<{ messages: ParsedInbound[]; cursor: PollCursor }> {
  if (!mailbox.nangoConnectionId || !env.NANGO_SECRET_KEY) {
    return { messages: [], cursor };
  }
  const nango = getNango();
  let historyId = cursor.gmailHistoryId;

  if (!historyId) {
    const profile = await nango.get({
      endpoint: "/gmail/v1/users/me/profile",
      providerConfigKey: GMAIL_PROVIDER_KEY,
      connectionId: mailbox.nangoConnectionId,
    });
    historyId = String((profile.data as { historyId?: string }).historyId ?? "");
    if (!historyId) return { messages: [], cursor: { ...cursor, gmailHistoryId: historyId } };
  }

  let historyResponse: { data: unknown; status: number };
  try {
    historyResponse = await nango.get({
      endpoint: "/gmail/v1/users/me/history",
      providerConfigKey: GMAIL_PROVIDER_KEY,
      connectionId: mailbox.nangoConnectionId,
      params: {
        startHistoryId: historyId,
        historyTypes: "messageAdded",
      },
    });
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404 || status === 410) {
      return pollGmailFullResync(mailbox, since);
    }
    throw err;
  }

  const historyData = historyResponse.data as {
    history?: { messagesAdded?: { message?: { id?: string } }[] }[];
    historyId?: string;
  };

  const messageIds = new Set<string>();
  for (const entry of historyData.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      if (added.message?.id) messageIds.add(added.message.id);
    }
  }

  const messages: ParsedInbound[] = [];
  for (const id of messageIds) {
    const parsed = await fetchGmailRawMessage(mailbox.nangoConnectionId, id);
    if (parsed) messages.push(parsed);
  }

  return {
    messages,
    cursor: {
      ...cursor,
      gmailHistoryId: historyData.historyId ?? historyId,
    },
  };
}

async function pollGmailFullResync(
  mailbox: typeof tables.mailbox.$inferSelect,
  since: Date,
): Promise<{ messages: ParsedInbound[]; cursor: PollCursor }> {
  if (!mailbox.nangoConnectionId) return { messages: [], cursor: {} };
  const nango = getNango();
  const afterSec = Math.floor(since.getTime() / 1000);
  const listResponse = await nango.get({
    endpoint: "/gmail/v1/users/me/messages",
    providerConfigKey: GMAIL_PROVIDER_KEY,
    connectionId: mailbox.nangoConnectionId,
    params: { q: `after:${afterSec}`, maxResults: "50" },
  });
  const listData = listResponse.data as { messages?: { id: string }[] };
  const messages: ParsedInbound[] = [];
  for (const item of listData.messages ?? []) {
    const parsed = await fetchGmailRawMessage(mailbox.nangoConnectionId, item.id);
    if (parsed) messages.push(parsed);
  }
  const profile = await nango.get({
    endpoint: "/gmail/v1/users/me/profile",
    providerConfigKey: GMAIL_PROVIDER_KEY,
    connectionId: mailbox.nangoConnectionId,
  });
  const historyId = String((profile.data as { historyId?: string }).historyId ?? "");
  return { messages, cursor: { gmailHistoryId: historyId } };
}

async function fetchGmailRawMessage(
  connectionId: string,
  messageId: string,
): Promise<ParsedInbound | null> {
  const nango = getNango();
  const response = await nango.get({
    endpoint: `/gmail/v1/users/me/messages/${messageId}`,
    providerConfigKey: GMAIL_PROVIDER_KEY,
    connectionId,
    params: { format: "raw" },
  });
  const data = response.data as { raw?: string; threadId?: string; internalDate?: string };
  if (!data.raw) return null;
  const rawMime = Buffer.from(data.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
  const parsed = await parseRawMime(rawMime, messageId, data.threadId ?? null);
  if (data.internalDate) {
    parsed.receivedAt = new Date(Number(data.internalDate));
  }
  return parsed;
}

async function pollMicrosoft(
  mailbox: typeof tables.mailbox.$inferSelect,
  cursor: PollCursor,
  since: Date,
): Promise<{ messages: ParsedInbound[]; cursor: PollCursor }> {
  if (!mailbox.nangoConnectionId || !env.NANGO_SECRET_KEY) {
    return { messages: [], cursor };
  }
  const nango = getNango();
  let endpoint = graphEndpointFromDeltaLink(cursor.microsoftDeltaLink);
  const rawItems: NonNullable<GraphDeltaPage["value"]>[number][] = [];
  let deltaLink = cursor.microsoftDeltaLink;
  let pageCount = 0;
  let lastDeltaLink: string | undefined;

  while (pageCount < MS_DELTA_PAGE_CAP) {
    let response: { data: unknown; status: number };
    try {
      response = await nango.get({
        endpoint,
        providerConfigKey: MS_PROVIDER_KEY,
        connectionId: mailbox.nangoConnectionId,
      });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (pageCount === 0 && (status === 404 || status === 410)) {
        return pollMicrosoft(mailbox, {}, since);
      }
      throw err;
    }

    const data = response.data as GraphDeltaPage;
    rawItems.push(...(data.value ?? []));
    pageCount += 1;

    if (data["@odata.deltaLink"]) {
      lastDeltaLink = data["@odata.deltaLink"];
    }

    const nextLink = data["@odata.nextLink"];
    if (!nextLink) break;
    endpoint = graphEndpointFromDeltaLink(nextLink);
  }

  logger.info(
    { mailboxId: mailbox.id, pageCount, messageCount: rawItems.length },
    "microsoft delta poll pages fetched",
  );

  const messages: ParsedInbound[] = [];
  for (const item of filterMessagesSince(dedupeGraphMessages(rawItems), since)) {
    const mimeResponse = await nango.get({
      endpoint: `/v1.0/me/messages/${item.id}/$value`,
      providerConfigKey: MS_PROVIDER_KEY,
      connectionId: mailbox.nangoConnectionId,
    });
    const rawMime =
      typeof mimeResponse.data === "string"
        ? mimeResponse.data
        : Buffer.from(mimeResponse.data as ArrayBuffer).toString("utf8");
    const parsed = await parseRawMime(rawMime, item.id, item.conversationId ?? null);
    if (item.receivedDateTime) parsed.receivedAt = new Date(item.receivedDateTime);
    messages.push(parsed);
  }

  return {
    messages,
    cursor: {
      ...cursor,
      microsoftDeltaLink: lastDeltaLink ?? deltaLink,
    },
  };
}

async function pollImap(
  mailbox: typeof tables.mailbox.$inferSelect,
  cursor: PollCursor,
  since: Date,
): Promise<{ messages: ParsedInbound[]; cursor: PollCursor }> {
  const key = env.MAILBOX_ENCRYPTION_KEY;
  if (!key || typeof mailbox.smtpConfig !== "string") {
    return { messages: [], cursor };
  }
  const smtp = decryptSmtpConfig(mailbox.smtpConfig, key);
  if (!smtp.auth?.user || !smtp.auth.pass) {
    return { messages: [], cursor };
  }

  const imapPort = smtp.secure ? 993 : 143;
  const client = new ImapFlow({
    host: smtp.host,
    port: imapPort,
    secure: smtp.secure ?? imapPort === 993,
    auth: { user: smtp.auth.user, pass: smtp.auth.pass },
    logger: false,
  });

  const messages: ParsedInbound[] = [];
  let maxUid = cursor.imapLastUid ?? 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ since }, { uid: true });
      const uidList = (uids === false ? [] : uids).filter(
        (uid: number) => uid > (cursor.imapLastUid ?? 0),
      );
      for (const uid of uidList) {
        const msg = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const rawMime = msg.source.toString("utf8");
        const parsed = await parseRawMime(rawMime, `imap-${uid}`, null);
        messages.push(parsed);
        if (uid > maxUid) maxUid = uid;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return { messages, cursor: { ...cursor, imapLastUid: maxUid } };
}

async function parseRawMime(
  rawMime: string,
  providerMessageId: string,
  providerThreadId: string | null,
): Promise<ParsedInbound> {
  const mail = await simpleParser(rawMime);
  const headers: Record<string, string> = {};
  for (const [key, value] of mail.headers) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
    else if (value && typeof value === "object" && "value" in value) {
      headers[key] = String((value as { value: unknown }).value);
    }
  }

  const fromAddress = mail.from?.value?.[0]?.address ?? null;
  const bounce = parseBounce(rawMime);

  return {
    providerMessageId,
    providerThreadId,
    messageIdHeader: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references: mail.references
      ? Array.isArray(mail.references)
        ? mail.references.join(" ")
        : String(mail.references)
      : null,
    subject: mail.subject ?? null,
    bodyHtml: typeof mail.html === "string" ? mail.html : null,
    bodyText: mail.text ?? null,
    fromEmail: bounce?.recipient ?? fromAddress,
    rawMime,
    receivedAt: mail.date ?? new Date(),
    headers,
    bounceType: bounce?.type ?? null,
  };
}

function parsePollCursor(raw: unknown): PollCursor {
  if (!raw || typeof raw !== "object") return {};
  return raw as PollCursor;
}

async function loadOrgInboxSettings(organizationId: string): Promise<OrgInboxSettings> {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, organizationId),
  });
  if (!org?.metadata) return { stop_on_ooo: false };
  try {
    const parsed = JSON.parse(org.metadata) as { stop_on_ooo?: boolean };
    return { stop_on_ooo: parsed.stop_on_ooo ?? false };
  } catch {
    return { stop_on_ooo: false };
  }
}
