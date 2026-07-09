import { Link, createFileRoute } from "@tanstack/react-router";
import { Ban, Check, Loader2, Reply, Search, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InboxThreadSummary } from "@/lib/inbox-types.ts";
import {
  getInboxThread,
  listInboxThreads,
  markAllInboxRead,
  sendReply,
  suppressEmail,
} from "@/lib/inbox.functions.ts";
import { listMailboxes } from "@/lib/mailboxes.functions.ts";
import { listSequences } from "@/lib/sequences.functions.ts";

/* ─── Contracts ─────────────────────────────────────────────────────────── */

type MessageDirection = "inbound" | "outbound";

type MessageSentiment =
  | "interested"
  | "not_now"
  | "objection"
  | "out_of_office"
  | "unsubscribe_request";

type InboxMessage = {
  id: string;
  direction: MessageDirection;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  status: string;
  bounceType: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  enrollmentId: string | null;
  prospectId: string | null;
  sentiment: MessageSentiment | null;
};

type InboxThreadDetail = {
  threadKey: string;
  mailbox: { id: string; address: string; displayName: string | null } | null;
  messages: InboxMessage[];
};

type StatusFilter = "all" | "unread" | "replied" | "bounced";

export const Route = createFileRoute("/_protected/inbox/")({
  component: InboxPage,
});

const STATUS_CHIPS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "replied", label: "Replied" },
  { id: "bounced", label: "Bounced" },
];

const SENTIMENT_LABELS: Record<MessageSentiment, string> = {
  interested: "Interested",
  not_now: "Not now",
  objection: "Objection",
  out_of_office: "OOO",
  unsubscribe_request: "Unsubscribe",
};

function InboxPage() {
  const [threads, setThreads] = useState<InboxThreadSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<InboxThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [mailboxId, setMailboxId] = useState("");
  const [sequenceId, setSequenceId] = useState("");
  const [query, setQuery] = useState("");
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; address: string }>>([]);
  const [sequences, setSequences] = useState<Array<{ id: string; name: string }>>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listInboxThreads({
        data: {
          unread: status === "unread" ? true : undefined,
          replied: status === "replied" ? true : undefined,
          bounced: status === "bounced" ? true : undefined,
          mailboxId: mailboxId || undefined,
          sequenceId: sequenceId || undefined,
          limit: 100,
        },
      });
      setThreads(result.threads);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [status, mailboxId, sequenceId]);

  useEffect(() => {
    void Promise.all([listMailboxes(), listSequences({ data: {} })]).then(([mb, seq]) => {
      setMailboxes(mb.map((m) => ({ id: m.id, address: m.address })));
      setSequences(seq.map((s) => ({ id: s.id, name: s.name })));
    });
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedKey) {
      setThreadDetail(null);
      return;
    }
    setDetailLoading(true);
    void getInboxThread({ data: { threadKey: selectedKey } })
      .then((detail) => {
        setThreadDetail(detail as InboxThreadDetail);
        window.requestAnimationFrame(() => {
          const el = messageScrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setDetailLoading(false));
  }, [selectedKey]);

  const selectedSummary = useMemo(
    () => threads.find((t) => t.threadKey === selectedKey) ?? null,
    [threads, selectedKey],
  );

  const unreadCount = useMemo(
    () => threads.reduce((n, t) => n + (t.unreadCount > 0 ? 1 : 0), 0),
    [threads],
  );

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const hay = [t.subject, t.prospectName, t.prospectEmail, t.preview, t.mailboxAddress]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [threads, query]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllInboxRead({ data: {} });
      toast.success("Marked all read");
      void loadThreads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark read");
    }
  }, [loadThreads]);

  const handleSendReply = useCallback(async () => {
    if (!selectedKey || !replyBody.trim()) return;
    setSending(true);
    try {
      await sendReply({
        data: { threadKey: selectedKey, bodyHtml: `<p>${escapeHtml(replyBody)}</p>` },
      });
      toast.success("Reply sent");
      setReplyBody("");
      void loadThreads();
      const detail = await getInboxThread({ data: { threadKey: selectedKey } });
      setThreadDetail(detail as InboxThreadDetail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }, [selectedKey, replyBody, loadThreads]);

  const handleSuppress = useCallback(async () => {
    const email = selectedSummary?.prospectEmail;
    if (!email) return;
    try {
      await suppressEmail({ data: { email, reason: "manual" } });
      toast.success(`Suppressed ${email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to suppress");
    }
  }, [selectedSummary]);

  const closeReader = useCallback(() => {
    setSelectedKey(null);
    setReplyBody("");
  }, []);

  const markDone = useCallback(() => {
    void loadThreads();
    closeReader();
    toast.success("Marked done");
  }, [loadThreads, closeReader]);

  return (
    <div className="flex h-[100dvh] bg-background">
      {/* ─── Left pane — thread index ─────────────────────────────────── */}
      <aside
        className="flex w-[340px] shrink-0 flex-col border-r border-border"
        aria-label="Threads"
      >
        <div className="shrink-0 border-b border-border px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="micro-label">Inbox</div>
              <div className="mt-0.5 text-[0.9375rem] font-semibold tracking-[-0.015em]">
                {threads.length} thread{threads.length === 1 ? "" : "s"}
                {unreadCount > 0 && (
                  <span className="ml-2 font-mono text-[0.6875rem] tabular text-[color:var(--ink-red-600)]">
                    · {unreadCount} unread
                  </span>
                )}
              </div>
            </div>
            <Link
              to="/settings/suppression"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")}
              title="Suppression list"
              aria-label="Suppression list"
            >
              <Ban className="h-3 w-3" />
            </Link>
          </div>

          <div className="relative mt-2.5">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[color:var(--paper-400)]" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject, sender, body…"
              className="pl-6"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {STATUS_CHIPS.map((chip) => {
              const active = status === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setStatus(chip.id)}
                  className={cn(
                    "rounded-[3px] px-1.5 py-0.5 text-[0.6875rem] font-medium",
                    "transition-colors duration-120",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="ml-auto text-[0.6875rem] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
              title="Mark all threads as read"
            >
              Mark all read
            </button>
          </div>

          {(mailboxes.length > 1 || sequences.length > 1) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {mailboxes.length > 1 && (
                <MiniSelect
                  value={mailboxId}
                  onChange={setMailboxId}
                  options={[{ value: "", label: "All mailboxes" }].concat(
                    mailboxes.map((m) => ({ value: m.id, label: m.address })),
                  )}
                />
              )}
              {sequences.length > 1 && (
                <MiniSelect
                  value={sequenceId}
                  onChange={setSequenceId}
                  options={[{ value: "", label: "All sequences" }].concat(
                    sequences.map((s) => ({ value: s.id, label: s.name })),
                  )}
                />
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
                {query ? "No threads match that search." : "No threads yet."}
              </p>
            </div>
          ) : (
            <ul>
              {filteredThreads.map((thread) => (
                <ThreadRow
                  key={thread.threadKey}
                  thread={thread}
                  selected={selectedKey === thread.threadKey}
                  onSelect={() => setSelectedKey(thread.threadKey)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ─── Right pane — the reader ──────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        {!selectedKey ? (
          <ReaderEmpty />
        ) : detailLoading && !threadDetail ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : threadDetail ? (
          <ThreadReader
            detail={threadDetail}
            summary={selectedSummary}
            replyBody={replyBody}
            onReplyChange={setReplyBody}
            sending={sending}
            composerRef={composerRef}
            messageScrollRef={messageScrollRef}
            onSend={() => void handleSendReply()}
            onReply={() => composerRef.current?.focus()}
            onSuppress={() => void handleSuppress()}
            onMarkDone={markDone}
            onClose={closeReader}
          />
        ) : null}
      </main>
    </div>
  );
}

/* ─── Thread row ────────────────────────────────────────────────────────── */

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: InboxThreadSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const unread = thread.unreadCount > 0;
  const sentiment = thread.sentiment as MessageSentiment | null;
  const senderLabel = thread.prospectName ?? thread.prospectEmail ?? "Unknown";
  const subject = thread.subject ?? "(no subject)";
  const preview = thread.preview ?? "";

  return (
    <li>
      <button
        type="button"
        data-selected={selected}
        onClick={onSelect}
        className={cn(
          "group relative flex w-full flex-col items-stretch px-3 py-2.5 pl-3.5 text-left",
          "border-b border-border/60",
          "transition-colors duration-120",
          "hover:bg-[color:var(--paper-050)]",
          "focus-visible:outline-none focus-visible:bg-[color:var(--paper-050)]",
          selected && "bg-[color:var(--paper-100)] hover:bg-[color:var(--paper-100)]",
        )}
      >
        {unread && (
          <span
            aria-hidden
            className="absolute left-1 top-3 h-1.5 w-1.5 rounded-full bg-[color:var(--ink-red-600)]"
          />
        )}

        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[0.75rem]",
              unread ? "font-semibold text-foreground" : "font-medium text-foreground",
            )}
          >
            {senderLabel}
          </span>
          <span className="shrink-0 font-mono text-[0.6875rem] tabular text-muted-foreground">
            {formatShortTime(thread.lastMessageAt)}
          </span>
        </div>

        <div
          className={cn(
            "mt-0.5 truncate text-[0.75rem]",
            unread ? "font-medium text-foreground" : "text-foreground",
          )}
        >
          {subject}
        </div>

        {preview && (
          <div className="mt-0.5 line-clamp-2 text-[0.6875rem] leading-[1.35] text-muted-foreground">
            {preview}
          </div>
        )}

        {(thread.hasBounce || sentiment) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {thread.hasBounce && (
              <Badge variant="destructive" className="text-[0.625rem]">
                bounce
              </Badge>
            )}
            {sentiment && !thread.hasBounce && (
              <Badge
                variant={sentiment === "interested" ? "success" : "subtle"}
                className="text-[0.625rem]"
              >
                {SENTIMENT_LABELS[sentiment]}
              </Badge>
            )}
          </div>
        )}
      </button>
    </li>
  );
}

/* ─── Reader empty state ────────────────────────────────────────────────── */

function ReaderEmpty() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="micro-label">No thread selected</div>
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted-foreground">
          Choose a thread from the list. Replies from prospects land here as your sequences run.
        </p>
      </div>
    </div>
  );
}

/* ─── Thread reader ─────────────────────────────────────────────────────── */

function ThreadReader({
  detail,
  summary,
  replyBody,
  onReplyChange,
  sending,
  composerRef,
  messageScrollRef,
  onSend,
  onReply,
  onSuppress,
  onMarkDone,
  onClose,
}: {
  detail: InboxThreadDetail;
  summary: InboxThreadSummary | null;
  replyBody: string;
  onReplyChange: (v: string) => void;
  sending: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  messageScrollRef: React.RefObject<HTMLDivElement | null>;
  onSend: () => void;
  onReply: () => void;
  onSuppress: () => void;
  onMarkDone: () => void;
  onClose: () => void;
}) {
  const messages = detail.messages;
  const firstSubject = summary?.subject ?? messages[0]?.subject ?? "(no subject)";
  const status = statusLabelForThread(summary, messages);
  const senderLine = summary?.prospectName
    ? `${summary.prospectName} · ${summary.prospectEmail ?? ""}`.replace(/·\s*$/, "").trim()
    : (summary?.prospectEmail ?? "Unknown sender");
  const lastTs = summary?.lastMessageAt ?? messages.at(-1)?.receivedAt ?? messages.at(-1)?.sentAt;

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !sending && replyBody.trim()) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Reader header ────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="micro-label">{status}</span>
              {detail.mailbox && (
                <span className="font-mono text-[0.625rem] tabular text-muted-foreground">
                  via {detail.mailbox.address}
                </span>
              )}
            </div>
            <h1 className="mt-1 text-[1rem] font-semibold leading-tight tracking-[-0.01em] text-foreground">
              {firstSubject}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] text-muted-foreground">
              <span className="truncate font-medium text-foreground">{senderLine}</span>
              {lastTs && <span className="font-mono tabular">{formatFullTime(lastTs)}</span>}
              {summary?.sequenceId && summary.sequenceName && (
                <Link
                  to="/sequences/$id/edit"
                  params={{ id: summary.sequenceId }}
                  className="underline decoration-[color:var(--paper-300)] decoration-1 underline-offset-[3px] hover:text-foreground hover:decoration-foreground"
                >
                  {summary.sequenceName}
                </Link>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <IconAction label="Reply" onClick={onReply}>
              <Reply className="h-3 w-3" />
            </IconAction>
            <IconAction label="Suppress sender" onClick={onSuppress}>
              <Ban className="h-3 w-3" />
            </IconAction>
            <IconAction label="Mark done" onClick={onMarkDone}>
              <Check className="h-3 w-3" />
            </IconAction>
            <IconAction label="Close" onClick={onClose}>
              <X className="h-3 w-3" />
            </IconAction>
          </div>
        </div>
      </header>

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.map((msg) => (
          <MessageArticle key={msg.id} message={msg} />
        ))}
      </div>

      {/* ── Composer ─────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 shrink-0 border-t border-border bg-card px-5 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="micro-label">Reply</div>
            <span className="ink-mark-dot text-[0.625rem] font-mono uppercase tracking-wider text-[color:var(--ink-red-600)]">
              draft
            </span>
          </div>
          <div className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
            <span className="ml-0.5">send</span>
          </div>
        </div>
        <textarea
          ref={composerRef}
          value={replyBody}
          onChange={(e) => onReplyChange(e.target.value)}
          onKeyDown={onComposerKeyDown}
          rows={3}
          placeholder="Write your reply…"
          className={cn(
            "mt-1.5 block w-full resize-none rounded-[4px] border border-input bg-background px-2 py-1.5",
            "text-[0.8125rem] leading-[1.5] text-foreground",
            "placeholder:text-[color:var(--paper-400)]",
            "transition-[border-color] duration-120",
            "hover:border-[color:var(--paper-300)]",
            "focus-visible:outline-none focus-visible:border-[color:var(--paper-500)] focus-visible:ring-2 focus-visible:ring-[color:var(--paper-100)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          disabled={sending}
        />
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onReplyChange("")}
            disabled={!replyBody}
            className="text-[0.6875rem] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Clear
          </button>
          <Button
            variant="ink"
            size="default"
            onClick={onSend}
            disabled={sending || !replyBody.trim()}
          >
            {sending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-0.5 h-3 w-3" />
            )}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Individual message ────────────────────────────────────────────────── */

function MessageArticle({ message }: { message: InboxMessage }) {
  const ts = message.direction === "inbound" ? message.receivedAt : message.sentAt;
  const isOutbound = message.direction === "outbound";
  const hasHtml = Boolean(message.bodyHtml && message.bodyHtml.trim().length > 0);

  return (
    <article
      className={cn(
        "border-b border-border px-5 py-4 last:border-b-0",
        // Human-authored (outbound) messages get a red-ink left bar — the one
        // product-specific accent used throughout the design system.
        isOutbound && "ink-mark-bar",
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-[0.75rem] font-medium",
              isOutbound ? "text-[color:var(--ink-red-700)]" : "text-foreground",
            )}
          >
            {isOutbound ? "You" : "Prospect"}
          </span>
          <span className="font-mono text-[0.625rem] tabular text-muted-foreground">
            {isOutbound ? "outbound" : "inbound"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {message.bounceType && (
            <Badge variant="destructive" className="text-[0.625rem]">
              {message.bounceType} bounce
            </Badge>
          )}
          {ts && (
            <span className="font-mono text-[0.6875rem] tabular text-muted-foreground">
              {formatFullTime(ts)}
            </span>
          )}
        </div>
      </header>

      {hasHtml ? (
        <div
          className="mt-2.5 text-[0.8125rem] leading-[1.55] text-foreground [&_a]:text-[color:var(--link)] [&_a]:underline [&_a]:underline-offset-2 [&_p]:mb-2 [&_p:last-child]:mb-0"
          dangerouslySetInnerHTML={{ __html: message.bodyHtml ?? "" }}
        />
      ) : (
        <div className="mt-2.5 whitespace-pre-wrap text-[0.8125rem] leading-[1.55] text-foreground">
          {message.bodyText ?? ""}
        </div>
      )}
    </article>
  );
}

/* ─── Small primitives ──────────────────────────────────────────────────── */

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground",
        "transition-colors duration-120",
        "hover:bg-[color:var(--paper-100)] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {children}
    </button>
  );
}

function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-6 max-w-[9rem] truncate rounded-[3px] border border-border bg-card px-1.5 text-[0.6875rem]",
        "font-mono tabular text-muted-foreground",
        "transition-[border-color] duration-120",
        "hover:border-[color:var(--paper-300)]",
        "focus-visible:outline-none focus-visible:border-[color:var(--paper-500)] focus-visible:ring-2 focus-visible:ring-[color:var(--paper-100)]",
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ─── Formatting helpers ────────────────────────────────────────────────── */

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const monthDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const fullFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return timeFmt.format(d);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays >= 0 && diffDays < 7) return weekdayFmt.format(d);
  return monthDayFmt.format(d);
}

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return fullFmt.format(d);
}

function statusLabelForThread(
  summary: InboxThreadSummary | null,
  messages: InboxMessage[],
): string {
  if (summary?.hasBounce || messages.some((m) => m.bounceType)) return "Bounced";
  const sentiment = (summary?.sentiment ?? messages.find((m) => m.sentiment)?.sentiment) as
    | MessageSentiment
    | null
    | undefined;
  if (sentiment) return SENTIMENT_LABELS[sentiment];
  const lastDir = summary?.lastDirection ?? messages.at(-1)?.direction;
  if (lastDir === "inbound") return "Replied";
  return "Thread";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
