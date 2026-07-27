import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Absent, EmptyState, Pill, SkeletonRows } from "@/components/ui/primitives.tsx";
import { formatDate, formatRelative } from "@/lib/semantic.ts";
import {
  createValueProp,
  deleteValueProp,
  listValueProps,
  updateValueProp,
  type PublicValueProp,
} from "@/lib/value-props.functions";

export const Route = createFileRoute("/_protected/settings/value-props/")({
  component: ValuePropsPage,
});

type FormState = {
  title: string;
  body: string;
  tags: string;
};

const emptyForm: FormState = { title: "", body: "", tags: "" };

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function ValuePropsPage() {
  const [valueProps, setValueProps] = useState<PublicValueProp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PublicValueProp | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PublicValueProp | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setValueProps(await listValueProps());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load value props");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (vp: PublicValueProp) => {
    setEditing(vp);
    setForm({
      title: vp.title,
      body: vp.body,
      tags: vp.tags.join(", "),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error("Title and body are required");
      return;
    }
    setSaving(true);
    const tags = parseTags(form.tags);
    const action = editing
      ? updateValueProp({
          data: { id: editing.id, patch: { title: form.title, body: form.body, tags } },
        })
      : createValueProp({ data: { title: form.title, body: form.body, tags } });

    void action
      .then(() => {
        toast.success(editing ? "Value prop updated" : "Value prop created");
        closeDialog();
        return reload();
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setSaving(false));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteValueProp({ data: { id: deleteTarget.id } });
      toast.success("Value prop deleted");
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6 fade-in w-full min-w-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Value props
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your messaging pillars — AI generation maps prospects to these in Phase 8.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add value prop
        </Button>
      </div>

      {isLoading ? (
        <div className="panel overflow-hidden">
          <SkeletonRows rows={3} cols={4} />
        </div>
      ) : valueProps.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            hue="brand"
            title="No value props yet"
            body="Add your first messaging pillar to prepare for AI-assisted outreach."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add value prop
              </Button>
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {valueProps.map((vp) => (
              <TableRow key={vp.id}>
                <TableCell className="max-w-[28ch] truncate font-medium" title={vp.title}>
                  {vp.title}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {vp.tags.length === 0 ? (
                      <Absent>No tags</Absent>
                    ) : (
                      vp.tags.map((tag) => (
                        <Pill key={tag} tone="neutral">
                          {tag}
                        </Pill>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <span title={formatDate(vp.updatedAt) ?? undefined}>
                    {formatRelative(vp.updatedAt) ?? <Absent />}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit value prop "${vp.title}"`}
                      title="Edit"
                      onClick={() => openEdit(vp)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-[color:var(--neg)]"
                      aria-label={`Delete value prop "${vp.title}"`}
                      onClick={() => setDeleteTarget(vp)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ── Create / edit dialog ─────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit value prop" : "New value prop"}</DialogTitle>
            <DialogDescription>
              Describe a messaging pillar your team uses when reaching out to prospects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="vp-title" className="text-[0.8125rem] font-semibold">
                Title <span className="text-[color:var(--neg)]">*</span>
              </Label>
              <Input
                id="vp-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Cut manual research time"
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                Short headline — shown in the sequence builder when picking a pillar.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vp-body" className="text-[0.8125rem] font-semibold">
                Body <span className="text-[color:var(--neg)]">*</span>
              </Label>
              <Textarea
                id="vp-body"
                rows={6}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Full value proposition text for the AI prompt builder…"
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                The AI reads this verbatim when matching prospects to pillars — be specific.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vp-tags" className="text-[0.8125rem] font-semibold">
                Tags
              </Label>
              <Input
                id="vp-tags"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="efficiency, research, enterprise"
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                Comma-separated. Used to filter which pillars the AI considers for a sequence.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ───────────────────────────────────── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete value prop?</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.title}</strong> will be permanently removed. Sequences that
              reference this pillar will no longer surface it in AI generation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
