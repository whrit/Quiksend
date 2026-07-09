import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSequence } from "@/lib/sequences.functions.ts";

const searchSchema = z.object({
  anchorMessageId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_protected/sequences/new")({
  validateSearch: (search) => searchSchema.parse(search),
  component: NewSequencePage,
});

function NewSequencePage() {
  const { anchorMessageId } = Route.useSearch();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const seq = await createSequence({ data: { name: name.trim() } });
      toast.success("Sequence created");
      // Preserve the anchor context through the redirect so edit.tsx knows the
      // user came here from Compose → "Start a follow-up sequence from this message".
      void navigate({
        to: "/sequences/$id/edit",
        params: { id: seq.id },
        search: anchorMessageId ? { anchorMessageId } : {},
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <header className="rise">
        <div className="micro-label">Step 01 · Name your sequence</div>
        <h1 className="mt-2 font-display text-[2.5rem] leading-[0.95] tracking-[-0.025em]">
          A sequence begins with{" "}
          <span className="font-display-italic text-[color:var(--amber-600)]">a name</span>.
        </h1>
        <p className="mt-3 font-display-italic text-[1.0625rem] text-muted-foreground">
          Give it something you&rsquo;ll recognise six weeks from now.
        </p>
      </header>

      {anchorMessageId ? (
        <div className="rise rise-1 paper mt-8 p-4 text-[0.875rem]">
          <div className="micro-label">Anchored thread</div>
          <p className="mt-1.5 text-foreground">
            Replies land in message{" "}
            <code className="rounded-[4px] border border-border bg-secondary px-1.5 py-0.5 font-mono text-[0.75rem]">
              {anchorMessageId.slice(0, 8)}…
            </code>
            . The first{" "}
            <code className="font-mono text-[0.75rem] text-muted-foreground">auto_email</code> step
            will reply into that thread.
          </p>
        </div>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="rise rise-2 mt-10 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name" className="micro-label">
            Sequence name
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Outbound Q1"
            className="h-11 text-[1rem]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="accent" size="lg" disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create sequence"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => void navigate({ to: "/sequences" })}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
