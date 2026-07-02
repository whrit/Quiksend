import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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
import { listMailboxes, type PublicMailbox } from "@/lib/mailboxes.functions";

export const Route = createFileRoute("/_protected/compose")({
  component: ComposePage,
});

type MailboxRow = PublicMailbox;

function ComposePage() {
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Compose</h1>
        <p className="text-sm text-muted-foreground">
          Send a one-off email and capture the thread anchor for follow-up sequences.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border p-6">
        <div className="space-y-2">
          <Label>Mailbox</Label>
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
        </div>

        <div className="space-y-2">
          <Label>Prospect</Label>
          <Popover open={prospectOpen} onOpenChange={setProspectOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between font-normal">
                {prospectLabel || "Search prospects…"}
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
                      <CommandEmpty>No prospects found.</CommandEmpty>
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

        <div className="space-y-2">
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="body">Body</Label>
          <Textarea
            id="body"
            rows={10}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            placeholder="Write your message…"
          />
        </div>

        <Button onClick={() => void handleSend()} disabled={sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
        </Button>
      </div>

      {lastMessageId ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
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
