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

/* ─── Named contracts ───────────────────────────────────────────────────────
   The reader owns the shapes it renders. Declaring these here (instead of
   deriving via `ReturnType<typeof getInboxThread>`) documents the boundary
   between the server function and the UI, and stops the client from coupling
   to the handler's implementation details.                                 */

type MessageDirection = "inbound" | "outbound";

type MessageSentiment =
  | "interested"
  | "not_now"
  | "objection"
  | "out_of_office"
  | "unsubscribe_request";

/** One message inside an inbox thread as returned by `getInboxThread`. */
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

/** Full thread payload the reader pane renders. */
type InboxThreadDetail = {
  threadKey: string;
  mailbox: { id: string; address: string; displayName: string | null } | null;
  messages: InboxMessage[];
};

/** Which server-side status filter is currently active. */
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
  interested: "INTERESTED",
  not_now: "NOT NOW",
  objection: "OBJECTION",
  out_of_office: "OUT OF OFFICE",
  unsubscribe_request: "UNSUBSCRIBE REQUEST",
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
        // Scroll to bottom of message list so the newest reply is visible.
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
      toast.success("All threads marked read");
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
      toast.success(`${email} suppressed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to suppress");
    }
  }, [selectedSummary]);

  const closeReader = useCallback(() => {
    setSelectedKey(null);
    setReplyBody("");
  }, []);

  const markDone = useCallback(() => {
    // Opening the thread already marked its messages read on the server —
    // refresh the list so the row's unread state syncs, then close the reader.
    void loadThreads();
    closeReader();
    toast.success("Marked done");
  }, [loadThreads, closeReader]);

  return (
    <div className="flex h-[100dvh] bg-background">
      {/* ─── Left pane — thread index ─────────────────────────────────── */}
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-border">
        {/* Sticky header */}
        <div className="shrink-0 border-b border-border px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[0.6875rem] tabular text-muted-foreground">
                {unreadCount} unread
              </div>
              <h1 className="mt-1 font-display text-[1.75rem] leading-none tracking-[-0.02em]">
                Inbox
              </h1>
            </div>
            <Link
              to="/settings/suppression"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "h-7 shrink-0 text-[0.6875rem]",
              )}
              title="Suppression list"
            >
              <Ban className="h-3 w-3" />
            </Link>
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ink-400)]" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject, sender, body…"
              className="h-8 pl-7"
            />
          </div>

          {/* Status chips */}
          <div className="mt-3 flex flex-wrap items-center gap-1">
            {STATUS_CHIPS.map((chip) => {
              const active = status === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setStatus(chip.id)}
                  className={cn(
                    "rounded-[6px] px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.08em]",
                    "transition-[background-color,color,box-shadow] duration-150 ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--amber-600)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active
                      ? "bg-[color:var(--ink-100)] text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
                      : "text-[color:var(--ink-500)] hover:text-foreground",
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="ml-auto text-[0.6875rem] font-medium tracking-[-0.005em] text-[color:var(--ink-500)] hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
              title="Mark all threads as read"
            >
              Mark all read
            </button>
          </div>

          {/* Secondary filters — surfaced only when the user actually has
              multiple mailboxes or sequences to disambiguate. */}
          {(mailboxes.length > 1 || sequences.length > 1) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
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

        {/* Scrollable thread list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <div className="micro-label">Nothing here</div>
              <p className="max-w-[16rem] text-[0.75rem] leading-relaxed text-muted-foreground">
                {query
                  ? "No threads match that search. Try clearing the filter."
                  : "No threads yet. Replies to your sequences will land here."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]/60">
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
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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

/* ─── Thread row — a newspaper column preview ─────────────────────────── */

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
  const senderLabel = thread.prospectName ?? thread.prospectEmail ?? "Unknown sender";
  const subject = thread.subject ?? "(no subject)";
  const preview = thread.preview ?? "";

  return (
    <li className="relative">
      <button
        type="button"
        data-selected={selected}
        onClick={onSelect}
        className={cn(
          "group relative flex w-full flex-col items-stretch gap-0 px-4 py-3 pl-5 text-left",
          "transition-[background-color] duration-150 ease-out",
          "hover:bg-[color:var(--ink-100)]",
          "focus-visible:outline-none focus-visible:bg-[color:var(--ink-100)]",
          selected && "bg-card shadow-[inset_-2px_0_0_var(--amber-600)] hover:bg-card",
        )}
      >
        {/* Unread dot — the amber accent moment on this row */}
        {unread && (
          <span
            aria-hidden
            className="absolute left-1.5 top-[1.125rem] h-1.5 w-1.5 rounded-full bg-[color:var(--amber-600)]"
          />
        )}

        {/* Row 1 — sender + time */}
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[0.8125rem] tracking-[-0.005em]",
              unread ? "font-semibold text-foreground" : "font-medium text-foreground",
            )}
          >
            {senderLabel}
          </span>
          <span className="shrink-0 font-mono text-[0.6875rem] tabular text-muted-foreground">
            {formatShortTime(thread.lastMessageAt)}
          </span>
        </div>

        {/* Row 2 — subject */}
        <div
          className={cn(
            "mt-0.5 truncate text-[0.875rem] tracking-[-0.005em]",
            unread ? "font-bold text-foreground" : "font-semibold text-foreground",
          )}
        >
          {subject}
        </div>

        {/* Row 3 — preview */}
        {preview && (
          <div className="mt-0.5 line-clamp-2 text-[0.75rem] leading-[1.35] text-muted-foreground">
            {preview}
          </div>
        )}

        {/* Row 4 — status tag row (only when there's something to say) */}
        {(thread.hasBounce || sentiment) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {thread.hasBounce && (
              <Badge variant="destructive" className="font-mono text-[0.625rem]">
                bounce
              </Badge>
            )}
            {sentiment && !thread.hasBounce && (
              <Badge
                variant={sentiment === "interested" ? "accent" : "outline"}
                className="font-mono text-[0.625rem]"
              >
                {SENTIMENT_LABELS[sentiment].toLowerCase()}
              </Badge>
            )}
          </div>
        )}
      </button>
    </li>
  );
}

/* ─── Reader empty state ──────────────────────────────────────────────── */

function ReaderEmpty() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8">
      {/* Concentric editorial mark — mirrors the dashboard empty state */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.05]"
      >
        <svg width="440" height="440" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="34" stroke="currentColor" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="20" stroke="currentColor" strokeWidth="0.3" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.3" />
          <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeWidth="0.3" />
        </svg>
      </div>

      <div className="relative max-w-md text-center">
        <div className="micro-label">Nothing selected</div>
        <h2 className="mt-3 font-display text-[2rem] leading-[0.95] tracking-[-0.025em]">
          Pick a thread from the <span className="font-display-italic">left</span>.
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-[0.875rem] leading-relaxed text-muted-foreground">
          Replies land here as your prospects respond to sequences. Bounces and auto-replies get
          flagged.
        </p>
      </div>
    </div>
  );
}

/* ─── Thread reader — the broadsheet article ──────────────────────────── */

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
      {/* ── Article masthead ─────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="micro-label">{status}</div>
            <h1 className="mt-2 font-display text-[2.25rem] leading-[0.95] tracking-[-0.025em] text-foreground">
              {firstSubject}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-muted-foreground">
              <span className="truncate font-medium text-foreground">{senderLine}</span>
              {lastTs && <span className="font-mono tabular">{formatFullTime(lastTs)}</span>}
              {detail.mailbox && (
                <span className="font-mono tabular">via {detail.mailbox.address}</span>
              )}
              {summary?.sequenceId && summary.sequenceName && (
                <Link
                  to="/sequences/$id/edit"
                  params={{ id: summary.sequenceId }}
                  className="underline decoration-[color:var(--ink-300)] decoration-1 underline-offset-[3px] hover:text-foreground hover:decoration-foreground"
                >
                  {summary.sequenceName}
                </Link>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex shrink-0 items-center gap-0.5">
            <IconAction label="Reply" onClick={onReply}>
              <Reply className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label="Suppress sender" onClick={onSuppress}>
              <Ban className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label="Mark done" onClick={onMarkDone}>
              <Check className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label="Close" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </IconAction>
          </div>
        </div>
      </header>

      {/* ── Article body — a stack of messages ───────────────────────── */}
      <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.map((msg) => (
          <MessageArticle key={msg.id} message={msg} />
        ))}
      </div>

      {/* ── Docked reply composer ────────────────────────────────────── */}
      <div className="sticky bottom-0 shrink-0 border-t border-border bg-card px-8 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="micro-label">Reply</div>
          <div className="flex items-center gap-1 font-mono text-[0.6875rem] text-muted-foreground">
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
            <span className="ml-1">to send</span>
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
            "mt-2 block w-full resize-none rounded-[6px] border border-input bg-background px-3 py-2",
            "font-display text-[1rem] leading-[1.5] tracking-[-0.005em] text-foreground",
            "shadow-[inset_0_1px_1px_rgba(20,15,5,0.03)]",
            "placeholder:font-sans placeholder:text-[color:var(--ink-400)]",
            "transition-[border-color,box-shadow] duration-150",
            "hover:border-[color:var(--ink-300)]",
            "focus-visible:outline-none focus-visible:border-[color:var(--amber-600)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--amber-100)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          disabled={sending}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onReplyChange("")}
            disabled={!replyBody}
            className="text-[0.75rem] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Clear
          </button>
          <Button
            variant="accent"
            size="sm"
            onClick={onSend}
            disabled={sending || !replyBody.trim()}
          >
            {sending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1 h-3.5 w-3.5" />
            )}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Individual message article ──────────────────────────────────────── */

function MessageArticle({ message }: { message: InboxMessage }) {
  const ts = message.direction === "inbound" ? message.receivedAt : message.sentAt;
  const directionLabel = message.direction === "inbound" ? "↓ inbound" : "↑ outbound";
  const hasHtml = Boolean(message.bodyHtml && message.bodyHtml.trim().length > 0);

  return (
    <article className="border-b border-border px-8 py-6 last:border-b-0">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-[0.8125rem] font-medium tracking-[-0.005em] text-foreground">
            {message.direction === "inbound" ? "From prospect" : "You"}
          </span>
          <span
            className={cn(
              "font-mono text-[0.6875rem] tabular",
              message.direction === "inbound"
                ? "text-[color:var(--ink-700)]"
                : "text-muted-foreground",
            )}
          >
            {directionLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {message.bounceType && (
            <Badge variant="destructive" className="font-mono text-[0.625rem]">
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
          className="mt-4 font-display text-[1.0625rem] leading-[1.55] text-foreground [&_a]:text-foreground [&_a]:underline [&_a]:decoration-[color:var(--ink-300)] [&_a]:underline-offset-[3px] [&_p]:mb-3 [&_p:last-child]:mb-0"
          dangerouslySetInnerHTML={{ __html: message.bodyHtml ?? "" }}
        />
      ) : (
        <div className="mt-4 whitespace-pre-wrap font-display text-[1.0625rem] leading-[1.55] text-foreground">
          {message.bodyText ?? ""}
        </div>
      )}
    </article>
  );
}

/* ─── Small primitives ────────────────────────────────────────────────── */

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
        "inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[color:var(--ink-700)]",
        "transition-[background-color,color,box-shadow,transform] duration-150 ease-out",
        "hover:bg-[color:var(--ink-100)] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--amber-600)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
        "h-6 max-w-[9rem] truncate rounded-[5px] border border-border bg-card px-1.5 text-[0.6875rem]",
        "font-mono tabular text-[color:var(--ink-700)]",
        "transition-[border-color] duration-150",
        "hover:border-[color:var(--ink-300)]",
        "focus-visible:outline-none focus-visible:border-[color:var(--amber-600)] focus-visible:ring-[2px] focus-visible:ring-[color:var(--amber-100)]",
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

/* ─── Formatting helpers ──────────────────────────────────────────────── */

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

/** Editorial label above the subject: REPLIED / BOUNCED / OUT-OF-OFFICE / … */
function statusLabelForThread(
  summary: InboxThreadSummary | null,
  messages: InboxMessage[],
): string {
  if (summary?.hasBounce || messages.some((m) => m.bounceType)) return "BOUNCED";
  const sentiment = (summary?.sentiment ?? messages.find((m) => m.sentiment)?.sentiment) as
    | MessageSentiment
    | null
    | undefined;
  if (sentiment) return SENTIMENT_LABELS[sentiment];
  const lastDir = summary?.lastDirection ?? messages.at(-1)?.direction;
  if (lastDir === "inbound") return "REPLIED";
  return "CONVERSATION";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
