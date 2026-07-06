import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { listProspects } from "@/lib/prospects.functions.ts";
import { getEnrollmentSegWarning } from "@/lib/organization.functions.ts";
import { enrollProspects, getSequence, previewSchedule } from "@/lib/sequences.functions.ts";
import { listMailboxes } from "@/lib/mailboxes.functions.ts";

export const Route = createFileRoute("/_protected/sequences/$id/enroll")({
  loader: async ({ params }) => {
    const [sequence, mailboxes] = await Promise.all([
      getSequence({ data: { id: params.id } }),
      listMailboxes(),
    ]);
    return { sequence, mailboxes };
  },
  component: EnrollPage,
});

type ProspectItem = Awaited<ReturnType<typeof listProspects>>["items"][number];
type ScheduleRow = Awaited<ReturnType<typeof previewSchedule>>[number];

const DEFERRAL_LABELS: Record<string, string> = {
  outside_window: "Outside window",
  business_day: "Business day",
  throttle: "Throttle",
  daily_cap: "Daily cap",
};

function EnrollPage() {
  const { sequence, mailboxes } = Route.useLoaderData();
  const { id } = Route.useParams();

  const [search, setSearch] = useState("");
  const [prospects, setProspects] = useState<ProspectItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [preview, setPreview] = useState<ScheduleRow[] | null>(null);
  const [previewMailboxId, setPreviewMailboxId] = useState<string | null>(null);
  const [segWarning, setSegWarning] = useState<Awaited<
    ReturnType<typeof getEnrollmentSegWarning>
  > | null>(null);

  const mailboxIds = sequence.settings.mailbox_ids;
  const mailboxLabelById = new Map(
    mailboxes.map((mb) => [mb.id, mb.address ?? mb.displayName ?? mb.id.slice(0, 8)]),
  );

  const searchProspects = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listProspects({
        data: { search: search || undefined, limit: 50 },
      });
      setProspects(result.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to search prospects");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void searchProspects();
  }, [searchProspects]);

  useEffect(() => {
    if (mailboxIds.length > 0 && !previewMailboxId) {
      setPreviewMailboxId(mailboxIds[0] ?? null);
    }
  }, [mailboxIds, previewMailboxId]);

  useEffect(() => {
    if (selected.size === 0) {
      setSegWarning(null);
      return;
    }
    void getEnrollmentSegWarning({ data: { prospectIds: [...selected] } })
      .then(setSegWarning)
      .catch(() => setSegWarning(null));
  }, [selected]);

  async function loadPreview() {
    if (!previewMailboxId) {
      toast.error("Select a mailbox for preview");
      return;
    }
    const firstSelected = [...selected][0];
    try {
      const result = await previewSchedule({
        data: {
          sequenceId: id,
          mailboxId: previewMailboxId,
          prospectId: firstSelected,
        },
      });
      setPreview(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to preview schedule");
    }
  }

  async function handleEnroll() {
    if (selected.size === 0) {
      toast.error("Select at least one prospect");
      return;
    }
    setEnrolling(true);
    try {
      const result = await enrollProspects({
        data: { sequenceId: id, prospectIds: [...selected] },
      });
      toast.success(`Enrolled ${result.enrolled} prospect(s)`, {
        description:
          result.skipped > 0
            ? `${result.skipped} skipped (already enrolled or invalid)`
            : undefined,
      });
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enroll");
    } finally {
      setEnrolling(false);
    }
  }

  function toggleProspect(prospectId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(prospectId)) next.delete(prospectId);
      else next.add(prospectId);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Enroll prospects</h1>
          <p className="text-sm text-muted-foreground">{sequence.name}</p>
        </div>
        <Link
          to="/sequences/$id/edit"
          params={{ id }}
          className={buttonVariants({ variant: "outline" })}
        >
          Back to builder
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void searchProspects()}
            />
            <Button variant="outline" onClick={() => void searchProspects()} disabled={loading}>
              Search
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prospects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      {loading ? "Loading…" : "No prospects found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  prospects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggleProspect(p.id)}
                        />
                      </TableCell>
                      <TableCell>{p.email}</TableCell>
                      <TableCell>
                        {[p.firstName, p.lastName].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-sm text-muted-foreground">{selected.size} selected</p>

          {segWarning?.showWarning && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              This selection includes {segWarning.segCount} prospect(s) behind SEGs. Your current
              mailboxes ({segWarning.unsafeMailboxProviders.join(", ") || "none"}) are not
              enterprise-safe.{" "}
              <Link to="/settings/deliverability" className="underline">
                Learn more
              </Link>
            </div>
          )}

          <Button onClick={() => void handleEnroll()} disabled={enrolling || selected.size === 0}>
            {enrolling ? "Enrolling…" : `Enroll ${selected.size || ""} prospect(s)`}
          </Button>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <h2 className="font-medium">Schedule preview</h2>

          {mailboxIds.length > 1 && (
            <div className="space-y-2">
              <Label>Preview mailbox</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={previewMailboxId ?? ""}
                onChange={(e) => setPreviewMailboxId(e.target.value)}
              >
                {mailboxIds.map((mbId: string) => (
                  <option key={mbId} value={mbId}>
                    {mailboxLabelById.get(mbId) ?? `${mbId.slice(0, 8)}…`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button variant="outline" onClick={() => void loadPreview()}>
            Preview schedule
          </Button>

          {preview && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Deferrals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((row) => (
                  <TableRow key={row.index}>
                    <TableCell>{row.index + 1}</TableCell>
                    <TableCell>{row.kind}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(row.scheduledAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.deferredBy.map((d, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {DEFERRAL_LABELS[d.kind] ?? d.kind}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
