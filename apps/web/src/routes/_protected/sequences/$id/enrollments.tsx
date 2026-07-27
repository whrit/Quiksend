import { Link, createFileRoute } from "@tanstack/react-router";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Absent, EmptyState, Pill } from "@/components/ui/primitives.tsx";
import { enrollmentTone, formatRelative } from "@/lib/semantic.ts";
import {
  getSequence,
  listEnrollments,
  pauseEnrollment,
  resumeEnrollment,
  stopEnrollment,
} from "@/lib/sequences.functions.ts";

export const Route = createFileRoute("/_protected/sequences/$id/enrollments")({
  loader: async ({ params }) => {
    const [sequence, enrollments] = await Promise.all([
      getSequence({ data: { id: params.id } }),
      listEnrollments({ data: { sequenceId: params.id } }),
    ]);
    return { sequence, enrollments };
  },
  component: EnrollmentsPage,
});

type EnrollmentRow = Awaited<ReturnType<typeof listEnrollments>>[number];

const TERMINAL_STATES = new Set(["stopped", "completed", "replied", "bounced", "failed"]);

function EnrollmentActionsCell({
  enrollment,
  busy,
  onAction,
}: {
  enrollment: EnrollmentRow;
  busy: boolean;
  onAction: (id: string, action: "pause" | "resume" | "stop") => void;
}) {
  const isTerminal = TERMINAL_STATES.has(enrollment.state);
  return (
    <div className="flex gap-1">
      {enrollment.state !== "paused" && !isTerminal && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onAction(enrollment.id, "pause")}
        >
          Pause
        </Button>
      )}
      {enrollment.state === "paused" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onAction(enrollment.id, "resume")}
        >
          Resume
        </Button>
      )}
      {!isTerminal && (
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() => onAction(enrollment.id, "stop")}
        >
          Stop
        </Button>
      )}
    </div>
  );
}

function enrollmentColumns(
  busyId: string | null,
  onAction: (id: string, action: "pause" | "resume" | "stop") => void,
): ColumnDef<EnrollmentRow>[] {
  return [
    {
      id: "prospect",
      header: "Prospect",
      cell: ({ row }) => {
        const p = row.original.prospect;
        if (!p) return <Absent>No prospect</Absent>;
        const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
        return (
          <div>
            <div className="max-w-[22ch] truncate font-medium" title={p.email}>
              {p.email}
            </div>
            {name ? (
              <div className="max-w-[22ch] truncate text-xs text-muted-foreground" title={name}>
                {name}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: "state",
      header: "State",
      cell: ({ row }) => (
        <Pill tone={enrollmentTone(row.original.state)} dot>
          {row.original.state.replace(/_/g, " ")}
        </Pill>
      ),
    },
    {
      accessorKey: "currentStepIndex",
      header: "Step",
      cell: ({ row }) => row.original.currentStepIndex + 1,
    },
    {
      accessorKey: "nextRunAt",
      header: "Next run",
      cell: ({ row }) =>
        row.original.nextRunAt ? (
          (formatRelative(row.original.nextRunAt) ?? <Absent>Not scheduled</Absent>)
        ) : (
          <Absent>Not scheduled</Absent>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <EnrollmentActionsCell
          enrollment={row.original}
          busy={busyId === row.original.id}
          onAction={onAction}
        />
      ),
    },
  ];
}

function EnrollmentsPage() {
  const { sequence, enrollments: initial } = Route.useLoaderData();
  const { id } = Route.useParams();
  const [enrollments, setEnrollments] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const fresh = await listEnrollments({ data: { sequenceId: id } });
    setEnrollments(fresh);
  }, [id]);

  const handleAction = useCallback(
    async (enrollmentId: string, action: "pause" | "resume" | "stop") => {
      setBusyId(enrollmentId);
      try {
        const fn =
          action === "pause"
            ? pauseEnrollment
            : action === "resume"
              ? resumeEnrollment
              : stopEnrollment;
        await fn({ data: { id: enrollmentId } });
        toast.success(`Enrollment ${action}d`);
        await reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const columns = useMemo(
    () =>
      enrollmentColumns(busyId, (enrollmentId, action) => void handleAction(enrollmentId, action)),
    [busyId, handleAction],
  );

  const table = useReactTable({
    data: enrollments,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Enrollments</h1>
          <p className="text-sm text-muted-foreground">{sequence.name}</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/sequences/$id/enroll"
            params={{ id }}
            className={buttonVariants({ variant: "outline" })}
          >
            Enroll more
          </Link>
          <Link
            to="/sequences/$id/edit"
            params={{ id }}
            className={buttonVariants({ variant: "outline" })}
          >
            Back to builder
          </Link>
        </div>
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
                    icon={<Users />}
                    hue="neutral"
                    title="No enrollments yet"
                    body="Enroll prospects to start running this sequence. Their progress will appear here."
                    action={
                      <Link
                        to="/sequences/$id/enroll"
                        params={{ id }}
                        className={buttonVariants({ size: "sm" })}
                      >
                        Enroll prospects
                      </Link>
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
    </div>
  );
}
