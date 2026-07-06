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
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New sequence</h1>
        <p className="text-sm text-muted-foreground">Give your sequence a name to get started.</p>
      </div>
      {anchorMessageId ? (
        <div className="rounded-md border bg-primary/5 p-3 text-sm">
          Anchored to message{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {anchorMessageId.slice(0, 8)}…
          </code>
          — the first <code>auto_email</code> step will reply into that thread.
        </div>
      ) : null}
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Outbound Q1"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create sequence"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigate({ to: "/sequences" })}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
