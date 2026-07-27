import { Link, createFileRoute } from "@tanstack/react-router";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { List, ListChecks, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import { Absent, EmptyState, Pill, Tile } from "@/components/ui/primitives.tsx";
import { formatCount, formatRelative, sequenceTone } from "@/lib/semantic.ts";
import { archiveSequence, createSequence, listSequences } from "@/lib/sequences.functions.ts";

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

type SequenceRow = Awaited<ReturnType<typeof listSequences>>[number];

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
        <div className="cell">
          <Tile size="sm" hue={sequenceTone(row.original.status)} tint>
            <ListChecks />
          </Tile>
          <Link
            to="/sequences/$id/edit"
            params={{ id: row.original.id }}
            className="max-w-[28ch] truncate font-medium hover:underline"
            title={row.original.name}
          >
            {row.original.name}
          </Link>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Pill tone={sequenceTone(row.original.status)} dot>
          {row.original.status}
        </Pill>
      ),
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
        if (total === 0) return <Absent>None enrolled</Absent>;
        return (
          <span>
            {formatCount(active)} <span className="text-muted-foreground">active</span>
          </span>
        );
      },
    },
    {
      accessorKey: "updatedAt",
      header: "Last modified",
      cell: ({ row }) => formatRelative(row.original.updatedAt) ?? <Absent>—</Absent>,
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
  const [searchInput, setSearchInput] = useState(search.search ?? "");

  useEffect(() => {
    setSearchInput(search.search ?? "");
  }, [search.search]);

  useEffect(() => {
    const next = searchInput.trim();
    const current = search.search ?? "";
    if (next === current) return;

    const handle = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, search: next || undefined }),
      });
    }, 300);

    return () => window.clearTimeout(handle);
  }, [searchInput, navigate, search.search]);

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
    <div className="mx-auto max-w-[1200px] px-6 py-6 fade-in w-full min-w-0">
      <header className="mb-4 flex items-end justify-between gap-6 border-b border-border pb-4">
        <div>
          <div className="micro-label">Outbound</div>
          <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Sequences
          </h1>
          <p className="mt-1 text-[0.75rem] text-muted-foreground">Multi-step outreach cadences.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Segmented control — rectangular, shares a single border, never pills */}
          <div
            aria-label="Filter by status"
            className="inline-flex overflow-hidden rounded-[4px] border border-border"
          >
            {(["draft", "active", "archived"] as const).map((s) => {
              const isActive = search.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() =>
                    void navigate({
                      search: { ...search, status: isActive ? undefined : s },
                    })
                  }
                  className={
                    isActive
                      ? "h-7 border-r border-border px-3 text-[0.6875rem] font-medium bg-[color:var(--brand-tint)] text-[color:var(--brand-700)] transition-colors duration-120 last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      : "h-7 border-r border-border px-3 text-[0.6875rem] font-medium text-muted-foreground transition-colors duration-120 hover:text-foreground last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-3 w-3" />
            New sequence
          </Button>
        </div>
      </header>

      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Search sequences…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="panel overflow-hidden">
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
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState
                    icon={<List />}
                    hue={search.status ? "neutral" : "brand"}
                    title={search.status ? `No ${search.status} sequences` : "No sequences yet"}
                    body={
                      search.status
                        ? `You have no ${search.status} sequences. Clear the filter to see all.`
                        : "Sequences automate multi-step outreach cadences — each step waits, sends, or prompts a task. Create your first to get started."
                    }
                    action={
                      search.status ? (
                        <button
                          type="button"
                          className="text-[0.8125rem] font-medium text-[color:var(--brand-600)] hover:underline"
                          onClick={() =>
                            void navigate({
                              search: { ...search, status: undefined },
                            })
                          }
                        >
                          Clear filter
                        </button>
                      ) : (
                        <Button size="sm" onClick={() => setNewOpen(true)}>
                          <Plus className="h-3 w-3" />
                          New sequence
                        </Button>
                      )
                    }
                  />
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
