import { Link, createFileRoute } from "@tanstack/react-router";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { archiveSequence, createSequence, listSequences } from "@/lib/sequences.functions.ts";

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

type SequenceRow = Awaited<ReturnType<typeof listSequences>>[number];

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  active: "default",
  archived: "outline",
};

function SequenceStatusCell({ status }: { status: string }) {
  return <Badge variant={statusVariant[status] ?? "secondary"}>{status}</Badge>;
}

function SequenceActionsCell({ row, onArchived }: { row: SequenceRow; onArchived: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/sequences/$id/edit" params={{ id: row.id }}>
            Edit
          </Link>
        </DropdownMenuItem>
        {row.status === "active" && (
          <DropdownMenuItem asChild>
            <Link to="/sequences/$id/enroll" params={{ id: row.id }}>
              Enroll prospects
            </Link>
          </DropdownMenuItem>
        )}
        {row.status === "active" && (
          <DropdownMenuItem asChild>
            <Link to="/sequences/$id/enrollments" params={{ id: row.id }}>
              View enrollments
            </Link>
          </DropdownMenuItem>
        )}
        {row.status !== "archived" && (
          <DropdownMenuItem
            onClick={async () => {
              try {
                await archiveSequence({ data: { id: row.id } });
                toast.success("Sequence archived");
                onArchived();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to archive");
              }
            }}
          >
            Archive
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function sequenceColumns(onArchived: () => void): ColumnDef<SequenceRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link
          to="/sequences/$id/edit"
          params={{ id: row.original.id }}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <SequenceStatusCell status={row.original.status} />,
    },
    {
      id: "steps",
      header: "Steps",
      cell: ({ row }) => row.original.stepCount ?? 0,
    },
    {
      id: "enrollments",
      header: "Enrollments",
      cell: ({ row }) => {
        const counts = row.original.enrollmentCounts;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const active = counts.active ?? 0;
        return total > 0 ? `${active} active / ${total}` : "—";
      },
    },
    {
      accessorKey: "updatedAt",
      header: "Last modified",
      cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString(),
    },
    {
      id: "actions",
      cell: ({ row }) => <SequenceActionsCell row={row.original} onArchived={onArchived} />,
    },
  ];
}

export const Route = createFileRoute("/_protected/sequences/")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => {
    const sequences = await listSequences({
      data: {
        search: deps.search.search,
        status: deps.search.status,
      },
    });
    return { sequences };
  },
  component: SequencesPage,
});

function SequencesPage() {
  const { sequences } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const columns = useMemo(
    () => sequenceColumns(() => void navigate({ to: "/sequences" })),
    [navigate],
  );

  const table = useReactTable({ data: sequences, columns, getCoreRowModel: getCoreRowModel() });

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const seq = await createSequence({ data: { name: newName.trim() } });
      toast.success("Sequence created");
      setNewOpen(false);
      setNewName("");
      void navigate({ to: "/sequences/$id/edit", params: { id: seq.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sequences</h1>
          <p className="text-sm text-muted-foreground">
            Build multi-step outreach sequences and enroll prospects.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New sequence
        </Button>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Search sequences…"
          defaultValue={search.search ?? ""}
          className="max-w-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void navigate({
                search: { ...search, search: e.currentTarget.value || undefined },
              });
            }
          }}
        />
        <div className="flex gap-2">
          {(["draft", "active", "archived"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={search.status === s ? "default" : "outline"}
              onClick={() =>
                void navigate({
                  search: { ...search, status: search.status === s ? undefined : s },
                })
              }
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No sequences yet.{" "}
                  <button type="button" className="underline" onClick={() => setNewOpen(true)}>
                    Create one
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New sequence</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="seq-name">Name</Label>
            <Input
              id="seq-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Outbound Q1"
              onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
