import { createFileRoute } from "@tanstack/react-router";
import { Activity, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Absent, EmptyState, Pill } from "@/components/ui/primitives.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SEG_GATEWAY_VALUES } from "@quiksend/core/deliverability";
import {
  getCanaryHistory,
  getDeliverabilityGrid,
  type DeliverabilitySignal,
} from "@/lib/deliverability.functions.ts";
import type { Tone } from "@/lib/semantic.ts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_protected/deliverability/")({
  component: DeliverabilityGridPage,
});

/**
 * Thresholds from packages/core/src/deliverability/canary-config.ts:
 *   pct >= 90 → green (pos)
 *   50 ≤ pct < 90 → yellow (warn)
 *   pct < 50 → red (neg)
 */
function signalTone(signal: DeliverabilitySignal): Tone {
  if (signal === "green") return "pos";
  if (signal === "yellow") return "warn";
  if (signal === "red") return "neg";
  return "neutral";
}

function arrivalTone(status: string): Tone {
  if (status === "inbox") return "pos";
  if (status === "spam" || status === "quarantine") return "warn";
  if (status === "dropped") return "neg";
  return "neutral";
}

function DeliverabilityGridPage() {
  const [windowDays, setWindowDays] = useState(7);
  const [grid, setGrid] = useState<Awaited<ReturnType<typeof getDeliverabilityGrid>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{
    mailboxId: string;
    gateway: string;
  } | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getCanaryHistory>> | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setGrid(await getDeliverabilityGrid({ data: { windowDays } }));
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    if (!drawer) return;
    setHistory(null);
    void getCanaryHistory({
      data: { mailboxId: drawer.mailboxId, gateway: drawer.gateway, limit: 20 },
    }).then((res) => setHistory(res));
  }, [drawer]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6 fade-in w-full min-w-0">
      <header className="mb-4 flex items-start justify-between gap-6 border-b border-border pb-4">
        <div>
          <div className="micro-label">Signal grid</div>
          <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Deliverability
          </h1>
          <p className="mt-1 max-w-[56ch] text-[0.75rem] text-muted-foreground">
            Canary sends probe seed inboxes at each enterprise gateway to measure inbox placement
            (share of sends that landed in the inbox, not spam or quarantine). Percentages update
            every 30 seconds. Click a cell to see the raw canary history.
          </p>
        </div>
        {/* Segmented control — rectangular segments, active in primary tint */}
        <div className="mt-1 inline-flex shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border">
          {([7, 14, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              className={cn(
                "h-8 border-r border-border px-3 text-[0.8125rem] font-medium last:border-r-0 focus-ring transition-colors",
                windowDays === days
                  ? "bg-[var(--brand-tint)] text-[var(--brand-700)]"
                  : "bg-card text-[var(--paper-600)] hover:bg-[var(--paper-050)]",
              )}
              onClick={() => setWindowDays(days)}
            >
              {days}d
            </button>
          ))}
        </div>
      </header>

      {loading && !grid ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mailbox</TableHead>
                {SEG_GATEWAY_VALUES.map((g) => (
                  <TableHead key={g} className="text-center text-xs">
                    {g.replace(/_/g, " ")}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(grid?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={SEG_GATEWAY_VALUES.length + 1} className="p-0">
                    <EmptyState
                      icon={<Activity />}
                      hue="brand"
                      title="No mailboxes configured"
                      body="Add a sending mailbox to start canary sends. Quiksend will probe seed inboxes at each gateway and populate this grid with inbox placement rates."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                (grid?.rows ?? []).map((row) => (
                  <TableRow key={row.mailboxId}>
                    <TableCell className="font-medium">{row.mailboxName}</TableCell>
                    {row.cells.map((cell) => (
                      <TableCell key={cell.gateway} className="text-center">
                        {cell.signal === "insufficient_data" ? (
                          <Absent>
                            {cell.canaryTotal === 0 ? "Not measured" : "Too few sends"}
                          </Absent>
                        ) : (
                          <button
                            type="button"
                            className="focus-ring inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-semibold tabular-nums"
                            style={{
                              background: `var(--${signalTone(cell.signal)}-tint)`,
                              color: `var(--${signalTone(cell.signal)})`,
                            }}
                            onClick={() =>
                              setDrawer({ mailboxId: row.mailboxId, gateway: cell.gateway })
                            }
                          >
                            {cell.deliverabilityPct}%
                          </button>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={Boolean(drawer)} onOpenChange={(open) => !open && setDrawer(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Canary history</SheetTitle>
            <SheetDescription>
              {drawer?.gateway.replace(/_/g, " ")} — recent canary sends and arrival evidence
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {!history ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : history.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No canary history for this pair yet.
              </p>
            ) : (
              history.items.map((item) => (
                <div key={item.id} className="rounded border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium" title={item.seedEmail}>
                      {item.seedEmail}
                    </span>
                    <Pill tone={arrivalTone(item.arrivalStatus)} dot>
                      {item.arrivalStatus}
                    </Pill>
                  </div>
                  <p className="mt-1 truncate text-muted-foreground" title={item.subject}>
                    {item.subject}
                  </p>
                  {item.arrivalGatewayHeaders ? (
                    <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                      {JSON.stringify(item.arrivalGatewayHeaders, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
