import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { MoreHorizontal, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addToList,
  bulkDeleteProspects,
  createList,
  createProspect,
  listCompanies,
  listLists,
  listProspects,
} from "@/lib/prospects.functions.ts";

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  listId: z.string().optional(),
  companyId: z.string().optional(),
  cursor: z.string().optional(),
});

type ProspectRow = Awaited<ReturnType<typeof listProspects>>["items"][number];

const statusOptions = [
  "new",
  "active",
  "replied",
  "bounced",
  "unsubscribed",
  "do_not_contact",
] as const;

const createProspectSchema = z.object({
  email: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  title: z.string().optional(),
});

export const Route = createFileRoute("/_protected/prospects/")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => {
    const { search } = deps;
    const status = search.status
      ? (search.status.split(",").filter(Boolean) as (typeof statusOptions)[number][])
      : undefined;

    const [prospects, lists, companies] = await Promise.all([
      listProspects({
        data: {
          search: search.search,
          status,
          listId: search.listId,
          companyId: search.companyId,
          cursor: search.cursor
            ? (JSON.parse(search.cursor) as { id: string; createdAt: string })
            : undefined,
          limit: 50,
        },
      }),
      listLists({ data: {} }),
      listCompanies({ data: { limit: 100 } }),
    ]);

    return { prospects, lists, companies: companies.items };
  },
  component: ProspectsPage,
});

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "replied" || status === "active") return "default";
  if (status === "bounced" || status === "do_not_contact") return "destructive";
  return "secondary";
}

function SelectAllHeader({ table }: { table: ReturnType<typeof useReactTable<ProspectRow>> }) {
  return (
    <Checkbox
      checked={
        table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
      }
      onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      aria-label="Select all"
    />
  );
}

function SelectRowCell({
  row,
}: {
  row: { getIsSelected: () => boolean; toggleSelected: (v: boolean) => void };
}) {
  return (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(v) => row.toggleSelected(!!v)}
      aria-label="Select row"
    />
  );
}

function prospectColumns(): ColumnDef<ProspectRow>[] {
  return [
    {
      id: "select",
      header: ({ table }) => <SelectAllHeader table={table} />,
      cell: ({ row }) => <SelectRowCell row={row} />,
    },
    {
      id: "name",
      header: "Name",
      accessorFn: (row) => [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
      cell: ({ row }) => (
        <Link
          to="/prospects/$id"
          params={{ id: row.original.id }}
          className="font-medium hover:underline"
        >
          {[row.original.firstName, row.original.lastName].filter(Boolean).join(" ") || "—"}
        </Link>
      ),
    },
    { accessorKey: "email", header: "Email" },
    {
      id: "company",
      header: "Company",
      accessorFn: (row) => row.companyName ?? "—",
    },
    {
      accessorKey: "title",
      header: "Title",
      accessorFn: (row) => row.title ?? "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => (
        <Badge variant={statusVariant(String(getValue()))}>{String(getValue())}</Badge>
      ),
    },
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge>,
    },
    {
      id: "activity",
      header: "Last activity",
      accessorFn: (row) => new Date(row.updatedAt).toLocaleDateString(),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to="/prospects/$id" params={{ id: row.original.id }}>
                View
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}

function ProspectsPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { prospects, lists, companies } = Route.useLoaderData();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addListOpen, setAddListOpen] = useState(false);
  const [newListOpen, setNewListOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [localSearch, setLocalSearch] = useState(search.search ?? "");

  const form = useForm<z.infer<typeof createProspectSchema>>({
    resolver: zodResolver(createProspectSchema),
    defaultValues: { email: "", firstName: "", lastName: "", title: "" },
  });

  const newListForm = useForm<{ name: string }>({
    resolver: zodResolver(z.object({ name: z.string().min(1) })),
    defaultValues: { name: "" },
  });

  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, v]) => v)
        .map(([id]) => id),
    [rowSelection],
  );

  const columns = useMemo(() => prospectColumns(), []);

  const table = useReactTable({
    data: prospects.items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
    getRowId: (row) => row.id,
  });

  const applyFilters = (patch: Partial<typeof search>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch, cursor: undefined }),
    });
  };

  const onCreateProspect = form.handleSubmit(async (values) => {
    try {
      await createProspect({ data: values });
      toast.success("Prospect created");
      setAddOpen(false);
      form.reset();
      void navigate({ search: (prev) => ({ ...prev }) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create prospect");
    }
  });

  const onBulkDelete = async () => {
    try {
      await bulkDeleteProspects({ data: { ids: selectedIds } });
      toast.success(`Deleted ${selectedIds.length} prospect(s)`);
      setDeleteOpen(false);
      setRowSelection({});
      void navigate({ search: (prev) => ({ ...prev }) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed");
    }
  };

  const onAddToList = async () => {
    if (!selectedListId) return;
    try {
      await addToList({ data: { listId: selectedListId, prospectIds: selectedIds } });
      toast.success("Added to list");
      setAddListOpen(false);
      setRowSelection({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add to list");
    }
  };

  const onCreateList = newListForm.handleSubmit(async (values) => {
    try {
      const list = await createList({ data: values });
      if (!list) throw new Error("List creation failed");
      toast.success("List created");
      setNewListOpen(false);
      newListForm.reset();
      setSelectedListId(list.id);
      void navigate({ search: (prev) => ({ ...prev }) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create list");
    }
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Prospects</h1>
          <p className="text-sm text-muted-foreground">Manage contacts, lists, and CSV imports.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/prospects/import" className={buttonVariants({ variant: "outline" })}>
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Link>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add prospect
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters({ search: localSearch || undefined });
          }}
        >
          <Input
            placeholder="Search email or name…"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-64"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <Select
          value={search.status ?? "all"}
          onValueChange={(v) => applyFilters({ status: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={search.listId ?? "all"}
          onValueChange={(v) => applyFilters({ listId: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="List" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lists</SelectItem>
            {lists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={search.companyId ?? "all"}
          onValueChange={(v) => applyFilters({ companyId: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Company" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name ?? c.domain ?? c.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">{selectedIds.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => setAddListOpen(true)}>
            Add to list
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </div>
      )}

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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No prospects yet. Add one or import a CSV.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-2">
        {search.cursor && (
          <Button variant="outline" onClick={() => applyFilters({ cursor: undefined })}>
            First page
          </Button>
        )}
        {prospects.nextCursor && (
          <Button
            variant="outline"
            onClick={() => applyFilters({ cursor: JSON.stringify(prospects.nextCursor) })}
          >
            Next page
          </Button>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add prospect</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onCreateProspect} className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit">Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.length} prospect(s)?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This soft-deletes the selected prospects. You can re-import them later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void onBulkDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addListOpen} onOpenChange={setAddListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to list</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Select value={selectedListId} onValueChange={setSelectedListId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a list" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" className="px-0" onClick={() => setNewListOpen(true)}>
              Create new list
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => void onAddToList()} disabled={!selectedListId}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newListOpen} onOpenChange={setNewListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create list</DialogTitle>
          </DialogHeader>
          <Form {...newListForm}>
            <form onSubmit={onCreateList} className="flex flex-col gap-3">
              <FormField
                control={newListForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit">Create list</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
