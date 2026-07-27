import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Absent, EmptyState, Pill, SkeletonRows } from "@/components/ui/primitives.tsx";
import { formatDate, suppressionTone } from "@/lib/semantic.ts";
import {
  bulkUnsuppressEmails,
  listSuppressions,
  suppressEmail,
  unsuppressEmail,
} from "@/lib/inbox.functions.ts";

export const Route = createFileRoute("/_protected/settings/suppression")({
  component: SuppressionPage,
});

function SuppressionPage() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listSuppressions>>["items"]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; email: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSuppressions({
        data: { search: search.trim() || undefined, limit: 100 },
      });
      setItems(result.items);
      setSelected({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load suppressions");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const handle = setTimeout(() => void reload(), 300);
    return () => clearTimeout(handle);
  }, [reload]);

  const selectedEmails = useMemo(
    () => items.filter((row) => selected[row.id]).map((row) => row.value),
    [items, selected],
  );

  const allSelected = items.length > 0 && selectedEmails.length === items.length;
  const someSelected = selectedEmails.length > 0 && !allSelected;

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const row of items) next[row.id] = true;
    setSelected(next);
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await unsuppressEmail({ data: { email: removeTarget.email } });
      toast.success(`${removeTarget.email} removed from suppression list`);
      setRemoveTarget(null);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemoving(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedEmails.length === 0) return;
    setBulkBusy(true);
    try {
      await bulkUnsuppressEmails({ data: { emails: selectedEmails } });
      toast.success(`Removed ${selectedEmails.length} suppression(s)`);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = addEmail.trim().toLowerCase();
    if (!email) return;
    setAddBusy(true);
    try {
      await suppressEmail({ data: { email, reason: "manual" } });
      toast.success(`${email} added to suppression list`);
      setAddEmail("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add suppression");
    } finally {
      setAddBusy(false);
    }
  };

  const handleExportCsv = () => {
    const rows = (selectedEmails.length > 0 ? items.filter((row) => selected[row.id]) : items).map(
      (row) => [row.value, row.reason, row.createdAt].join(","),
    );
    const csv = ["email,reason,created_at", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "suppressions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-6 fade-in w-full min-w-0">
      <div className="flex items-center gap-4">
        <Link to="/inbox" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Inbox
        </Link>
      </div>
      <div>
        <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
          Suppression list
        </h1>
        <p className="text-sm text-muted-foreground">
          Emails blocked from future sends due to bounces, unsubscribes, or manual blocks.
        </p>
      </div>

      <form
        onSubmit={(e) => void handleAdd(e)}
        className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3"
      >
        <Input
          type="email"
          placeholder="Add email to suppression list…"
          value={addEmail}
          onChange={(e) => setAddEmail(e.target.value)}
          disabled={addBusy}
          className="max-w-sm"
          required
        />
        <Button size="sm" type="submit" disabled={addBusy || !addEmail.trim()}>
          {addBusy ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1 h-4 w-4" />
          )}
          Add to suppression list
        </Button>
        <span className="text-xs text-muted-foreground">
          Blocks future sends and marks the prospect <code>do_not_contact</code>.
        </span>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {selectedEmails.length > 0 && (
          <>
            <Button
              size="sm"
              variant="secondary"
              className="text-[color:var(--neg)]"
              disabled={bulkBusy}
              onClick={() => void handleBulkDelete()}
            >
              {bulkBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              Remove selected ({selectedEmails.length})
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportCsv}>
              <Download className="mr-1 h-4 w-4" />
              Export CSV
            </Button>
          </>
        )}
        {selectedEmails.length === 0 && items.length > 0 && (
          <Button size="sm" variant="outline" onClick={handleExportCsv}>
            <Download className="mr-1 h-4 w-4" />
            Export all CSV
          </Button>
        )}
      </div>

      {loading ? (
        <div className="panel overflow-hidden">
          <SkeletonRows rows={5} cols={5} />
        </div>
      ) : items.length === 0 && !search ? (
        <div className="panel">
          <EmptyState
            title="Suppression list is empty"
            body="Emails are added automatically when a bounce or unsubscribe is detected, or manually above."
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected || (someSelected && "indeterminate")}
                  onCheckedChange={(v) => toggleAll(!!v)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No suppressions match &ldquo;{search}&rdquo; — try a different search.
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Checkbox
                      checked={!!selected[row.id]}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [row.id]: !!v }))}
                      aria-label={`Select ${row.value}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-[28ch] truncate font-mono text-sm" title={row.value}>
                    {row.value}
                  </TableCell>
                  <TableCell>
                    <Pill tone={suppressionTone(row.reason)} dot>
                      {row.reason}
                    </Pill>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(row.createdAt) ?? <Absent />}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-[color:var(--neg)]"
                      aria-label={`Remove ${row.value} from suppression list`}
                      onClick={() => setRemoveTarget({ id: row.id, email: row.value })}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {/* ── Remove confirmation dialog ───────────────────────────────────── */}
      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from suppression list?</DialogTitle>
            <DialogDescription>
              <strong className="font-mono">{removeTarget?.email}</strong> will be allowed to
              receive future sends again. Re-add it manually if needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removing} onClick={() => void confirmRemove()}>
              {removing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
