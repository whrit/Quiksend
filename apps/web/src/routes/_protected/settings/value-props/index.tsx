import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

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
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Value props</h1>
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
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : valueProps.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            No value props yet. Add your first messaging pillar to prepare for AI-assisted outreach.
          </p>
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
                <TableCell className="font-medium">{vp.title}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {vp.tags.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      vp.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(vp.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(vp)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete"
                      disabled={busyId === vp.id}
                      onClick={() => {
                        if (!confirm(`Delete value prop "${vp.title}"?`)) return;
                        setBusyId(vp.id);
                        void deleteValueProp({ data: { id: vp.id } })
                          .then(() => {
                            toast.success("Value prop deleted");
                            return reload();
                          })
                          .catch((err: Error) => toast.error(err.message))
                          .finally(() => setBusyId(null));
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit value prop" : "New value prop"}</DialogTitle>
            <DialogDescription>
              Describe a messaging pillar your team uses when reaching out to prospects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vp-title">Title</Label>
              <Input
                id="vp-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Cut manual research time"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vp-body">Body</Label>
              <Textarea
                id="vp-body"
                rows={6}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Full value proposition text for the AI prompt builder…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vp-tags">Tags (comma-separated)</Label>
              <Input
                id="vp-tags"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="efficiency, research, enterprise"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
