import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { searchProspects, sendComposedMessage } from "@/lib/compose.functions";
import { generateEmailForProspect } from "@/lib/ai.functions.ts";
import { listMailboxes, type PublicMailbox } from "@/lib/mailboxes.functions";

export const Route = createFileRoute("/_protected/compose")({
  validateSearch: (search: Record<string, unknown>) => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
    enrollmentId: typeof search.enrollmentId === "string" ? search.enrollmentId : undefined,
  }),
  component: ComposePage,
});

type MailboxRow = PublicMailbox;

function ComposePage() {
  const { taskId, enrollmentId } = Route.useSearch();
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [mailboxId, setMailboxId] = useState("");
  const [prospectId, setProspectId] = useState("");
  const [prospectLabel, setProspectLabel] = useState("");
  const [prospectOpen, setProspectOpen] = useState(false);
  const [prospectQuery, setProspectQuery] = useState("");
  const [prospectResults, setProspectResults] = useState<
    { id: string; label: string; email: string }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);
  const [aiAssisting, setAiAssisting] = useState(false);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);

  useEffect(() => {
    void listMailboxes()
      .then((rows) => {
        setMailboxes(rows);
        if (rows[0] && !mailboxId) setMailboxId(rows[0].id);
      })
      .catch((err: Error) => toast.error(err.message));
  }, [mailboxId]);

  useEffect(() => {
    if (prospectQuery.trim().length < 2) {
      setProspectResults([]);
      return;
    }
    const handle = setTimeout(() => {
      setSearching(true);
      void searchProspects({ data: { query: prospectQuery, limit: 10 } })
        .then((rows) => setProspectResults(rows))
        .catch(() => setProspectResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [prospectQuery]);

  const handleAiAssist = async () => {
    if (!prospectId) {
      toast.error("Select a prospect first");
      return;
    }
    setAiAssisting(true);
    try {
      const result = await generateEmailForProspect({ data: { prospectId } });
      if (result.status === "RESEARCH_PENDING") {
        toast.info("Research kicked off — try AI assist again in a few seconds");
        return;
      }
      setSubject(result.subject);
      setBodyHtml(result.body.replace(/\n/g, "<br>"));
      toast.success("AI draft loaded — review before sending");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI assist failed");
    } finally {
      setAiAssisting(false);
    }
  };

  const handleSend = async () => {
    if (!mailboxId || !prospectId || !subject.trim() || !bodyHtml.trim()) {
      toast.error("Mailbox, prospect, subject, and body are required");
      return;
    }
    setSending(true);
    try {
      const result = await sendComposedMessage({
        data: {
          mailboxId,
          prospectId,
          enrollmentId,
          subject,
          bodyHtml,
          bodyText: bodyHtml.replace(/<[^>]+>/g, " ").trim(),
        },
      });
      setLastMessageId(result.messageId);
      toast.success(`Sent — Message-Id ${result.messageId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const canSend = Boolean(mailboxId && prospectId && subject.trim() && bodyHtml.trim());

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 fade-in w-full min-w-0">
      <header className="mb-4 border-b border-border pb-4">
        <div className="micro-label">One-off</div>
        <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
          Compose
        </h1>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          Send a one-off email and capture the thread anchor for follow-up sequences.
        </p>
      </header>

      <div className="panel space-y-5 p-4">
        {/* ── Mailbox ─────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="font-semibold">Mailbox</Label>
          <p className="text-[0.75rem] text-muted-foreground">
            The sending address. Replies arrive in your Inbox for this mailbox.
          </p>
          {mailboxes.length === 0 ? (
            <p className="text-[0.75rem] text-[color:var(--warn)]">
              No mailboxes connected —{" "}
              <Link to="/settings/mailboxes" className="underline underline-offset-2">
                connect one first
              </Link>
              .
            </p>
          ) : (
            <Select value={mailboxId} onValueChange={setMailboxId}>
              <SelectTrigger>
                <SelectValue placeholder="Select mailbox" />
              </SelectTrigger>
              <SelectContent>
                {mailboxes.map((mb) => (
                  <SelectItem key={mb.id} value={mb.id}>
                    {mb.fromName ? `${mb.fromName} <${mb.address}>` : mb.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* ── Recipient ───────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="font-semibold">Recipient</Label>
          <p className="text-[0.75rem] text-muted-foreground">
            Must be an existing prospect. The thread anchor links to this person for follow-up
            sequences.
          </p>
          <Popover open={prospectOpen} onOpenChange={setProspectOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between font-normal">
                {prospectLabel ? (
                  prospectLabel
                ) : (
                  <span className="text-[color:var(--paper-400)]">Search prospects…</span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Type name or email…"
                  value={prospectQuery}
                  onValueChange={setProspectQuery}
                />
                <CommandList>
                  {searching ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>
                        <span className="text-[color:var(--paper-400)]">
                          {prospectQuery.trim().length < 2
                            ? "Type at least 2 characters to search"
                            : "No prospects found — add them via Prospects first"}
                        </span>
                      </CommandEmpty>
                      <CommandGroup>
                        {prospectResults.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={p.id}
                            onSelect={() => {
                              setProspectId(p.id);
                              setProspectLabel(`${p.label} (${p.email})`);
                              setProspectOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                prospectId === p.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            {p.label} — {p.email}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* ── Subject ─────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label htmlFor="subject" className="font-semibold">
            Subject
          </Label>
          <p className="text-[0.75rem] text-muted-foreground">
            Visible in the recipient's inbox — sets the open rate.
          </p>
          <div className="flex gap-2">
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              disabled={!prospectId || aiAssisting}
              onClick={() => void handleAiAssist()}
            >
              {aiAssisting ? <Loader2 className="h-4 w-4 animate-spin" /> : "AI-assist"}
            </Button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label htmlFor="body" className="font-semibold">
            Body
          </Label>
          <p className="text-[0.75rem] text-muted-foreground">
            Plain text or simple HTML. AI Assist drafts from prospect research when a recipient is
            selected.
          </p>
          <Textarea
            id="body"
            rows={10}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            placeholder="Write your message…"
          />
        </div>

        {/* ── Send ────────────────────────────────────────────────────── */}
        <Button
          className="w-full"
          onClick={() => void handleSend()}
          disabled={sending || !canSend}
          aria-busy={sending}
        >
          {sending ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className="mr-2 h-3.5 w-3.5" />
              Send email
            </>
          )}
        </Button>
      </div>

      {lastMessageId ? (
        <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm">
          <p>
            Sent with Message-Id: <code className="text-xs">{lastMessageId}</code>
          </p>
          <a
            className="text-primary underline"
            href={`/sequences/new?anchorMessageId=${encodeURIComponent(lastMessageId)}`}
          >
            Start a follow-up sequence from this message
          </a>
        </div>
      ) : null}
    </div>
  );
}
