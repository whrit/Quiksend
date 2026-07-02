import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listSuppressions, unsuppressEmail } from "@/lib/inbox.functions.ts";

export const Route = createFileRoute("/_protected/settings/suppression")({
  component: SuppressionPage,
});

function SuppressionPage() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listSuppressions>>["items"]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSuppressions({
        data: { search: search.trim() || undefined, limit: 100 },
      });
      setItems(result.items);
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

      <Input
        placeholder="Search by email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No suppressions found.
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow key={row.id}>
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
