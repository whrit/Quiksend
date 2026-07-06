import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);

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

  const handleRemove = async (email: string, id: string) => {
    setBusyId(id);
    try {
      await unsuppressEmail({ data: { email } });
      toast.success(`${email} removed from suppression list`);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setBusyId(null);
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/inbox" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Inbox
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Suppression list</h1>
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
              variant="destructive"
              disabled={bulkBusy}
              onClick={() => void handleBulkDelete()}
            >
              {bulkBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              Delete selected ({selectedEmails.length})
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
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No suppressions found.
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
                  <TableCell className="font-mono text-sm">{row.value}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.reason}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === row.id}
                      onClick={() => void handleRemove(row.value, row.id)}
                    >
                      {busyId === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
