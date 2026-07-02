import { Link, createFileRoute } from "@tanstack/react-router";
import { Ban, Inbox, Loader2, Mail, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  getInboxThread,
  listInboxThreads,
  markAllInboxRead,
  sendReply,
  suppressEmail,
  type InboxThreadSummary,
} from "@/lib/inbox.functions.ts";
import { listMailboxes } from "@/lib/mailboxes.functions.ts";
import { listSequences } from "@/lib/sequences.functions.ts";

export const Route = createFileRoute("/_protected/inbox/")({
  component: InboxPage,
});

type FilterState = {
  unread: boolean;
  replied: boolean;
  bounced: boolean;
  mailboxId: string;
  sequenceId: string;
};

function InboxPage() {
  const [threads, setThreads] = useState<InboxThreadSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<Awaited<
    ReturnType<typeof getInboxThread>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    unread: false,
    replied: false,
    bounced: false,
    mailboxId: "",
    sequenceId: "",
  });
  const [mailboxes, setMailboxes] = useState<{ id: string; address: string }[]>([]);
  const [sequences, setSequences] = useState<{ id: string; name: string }[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listInboxThreads({
        data: {
          unread: filters.unread || undefined,
          replied: filters.replied || undefined,
          bounced: filters.bounced || undefined,
          mailboxId: filters.mailboxId || undefined,
          sequenceId: filters.sequenceId || undefined,
          limit: 100,
        },
      });
      setThreads(result.threads);
      if (!selectedKey && result.threads[0]) {
        setSelectedKey(result.threads[0].threadKey);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [filters, selectedKey]);

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
      .then(setThreadDetail)
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setDetailLoading(false));
  }, [selectedKey]);

  const toggleFilter = (key: keyof Pick<FilterState, "unread" | "replied" | "bounced">) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllInboxRead({ data: {} });
      toast.success("All threads marked read");
      void loadThreads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark read");
    }
  };

  const handleSendReply = async () => {
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
      setThreadDetail(detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const handleSuppress = async (email: string | null) => {
    if (!email) return;
    try {
      await suppressEmail({ data: { email, reason: "manual" } });
      toast.success(`${email} suppressed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to suppress");
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Inbox className="h-6 w-6" />
            Inbox
          </h1>
          <p className="text-sm text-muted-foreground">
            Unified thread view for sequence replies and bounces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleMarkAllRead()}>
            Mark all read
          </Button>
          <Link
            to="/settings/suppression"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Ban className="mr-1 h-4 w-4" />
            Suppression list
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["unread", "replied", "bounced"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filters[key] ? "default" : "outline"}
            onClick={() => toggleFilter(key)}
          >
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </Button>
        ))}
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={filters.mailboxId}
          onChange={(e) => setFilters((p) => ({ ...p, mailboxId: e.target.value }))}
        >
          <option value="">All mailboxes</option>
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.address}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={filters.sequenceId}
          onChange={(e) => setFilters((p) => ({ ...p, sequenceId: e.target.value }))}
        >
          <option value="">All sequences</option>
          {sequences.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        <div ref={listRef} className="w-80 shrink-0 overflow-y-auto border-r bg-muted/20">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : threads.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No threads yet.</p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.threadKey}
                type="button"
                className={cn(
                  "w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  selectedKey === thread.threadKey && "bg-muted",
                )}
                onClick={() => setSelectedKey(thread.threadKey)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate font-medium">
                    {thread.prospectName ?? thread.prospectEmail ?? thread.subject ?? "Thread"}
                  </span>
                  {thread.unreadCount > 0 && (
                    <Badge variant="default" className="shrink-0 text-xs">
                      {thread.unreadCount}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{thread.preview}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  <span className="truncate">{thread.mailboxAddress}</span>
                  {thread.hasBounce && (
                    <Badge variant="destructive" className="text-[10px]">
                      bounce
                    </Badge>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {detailLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !threadDetail ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a thread
            </div>
          ) : (
            <>
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">
                  {threadDetail.messages[0]?.subject ?? "Conversation"}
                </h2>
                {threadDetail.mailbox && (
                  <p className="text-xs text-muted-foreground">
                    via {threadDetail.mailbox.address}
                  </p>
                )}
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {threadDetail.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "rounded-lg border p-3",
                      msg.direction === "inbound" ? "bg-muted/30" : "bg-background",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant={msg.direction === "inbound" ? "secondary" : "outline"}>
                        {msg.direction}
                      </Badge>
                      <div className="flex items-center gap-2">
                        {msg.bounceType && (
                          <Badge variant="destructive">{msg.bounceType} bounce</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {msg.receivedAt ?? msg.sentAt ?? ""}
                        </span>
                        {msg.direction === "inbound" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() =>
                              void handleSuppress(
                                threads.find((t) => t.threadKey === selectedKey)?.prospectEmail ??
                                  null,
                              )
                            }
                          >
                            <Ban className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div
                      className="prose prose-sm max-w-none text-sm"
                      dangerouslySetInnerHTML={{
                        __html: msg.bodyHtml ?? `<p>${escapeHtml(msg.bodyText ?? "")}</p>`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="border-t p-4">
                <Textarea
                  placeholder="Write a reply…"
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={3}
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    disabled={sending || !replyBody.trim()}
                    onClick={() => void handleSendReply()}
                  >
                    {sending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Send reply
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
