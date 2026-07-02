import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSequence } from "@/lib/sequences.functions.ts";

export const Route = createFileRoute("/_protected/sequences/new")({
  component: NewSequencePage,
});

function NewSequencePage() {
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
      void navigate({ to: "/sequences/$id/edit", params: { id: seq.id } });
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
