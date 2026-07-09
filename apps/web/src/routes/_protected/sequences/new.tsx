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
      await navigate({
        to: "/sequences/$id/edit",
        params: { id: seq.id },
        search: anchorMessageId ? { anchorMessageId } : {},
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create sequence");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <header className="mb-6 border-b border-border pb-4">
        <div className="micro-label">New sequence</div>
        <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
          Name your sequence
        </h1>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          You can edit steps and settings after creating.
        </p>
      </header>

      {anchorMessageId ? (
        <div className="panel mb-4 px-3 py-2 text-[0.75rem] text-muted-foreground">
          Follow-up sequence for message{" "}
          <code className="font-mono text-foreground">{anchorMessageId.slice(0, 8)}</code>.
        </div>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="sequence-name" className="text-[0.6875rem] font-medium">
            Name
          </Label>
          <Input
            id="sequence-name"
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            placeholder="Q4 outbound — CFOs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <Button type="submit" size="lg" disabled={creating || !name.trim()}>
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
