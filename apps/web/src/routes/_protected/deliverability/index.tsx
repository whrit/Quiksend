import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_protected/deliverability/")({
  component: DeliverabilityGridPage,
});

const SIGNAL_CLASS: Record<DeliverabilitySignal, string> = {
  green: "bg-emerald-500/20 text-emerald-800",
  yellow: "bg-amber-500/20 text-amber-900",
  red: "bg-red-500/20 text-red-900",
  insufficient_data: "bg-muted text-muted-foreground",
};

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
    <div className="mx-auto max-w-[1200px] px-6 py-6 fade-in">
      <header className="mb-4 flex items-end justify-between gap-6 border-b border-border pb-4">
        <div>
          <div className="micro-label">Signal grid</div>
          <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Deliverability
          </h1>
          <p className="mt-1 text-[0.75rem] text-muted-foreground">
            Per-mailbox × gateway delivery rate over the last window.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {[7, 14, 30].map((days) => (
            <Button
              key={days}
              size="default"
              variant={windowDays === days ? "default" : "outline"}
              onClick={() => setWindowDays(days)}
            >
              {days}d
            </Button>
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
                    {g.replace("_", " ")}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(grid?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={SEG_GATEWAY_VALUES.length + 1}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No mailboxes yet — add one to start seeing deliverability data.
                  </TableCell>
                </TableRow>
              ) : (
                (grid?.rows ?? []).map((row) => (
                  <TableRow key={row.mailboxId}>
                    <TableCell className="font-medium">{row.mailboxName}</TableCell>
                    {row.cells.map((cell) => (
                      <TableCell key={cell.gateway} className="text-center">
                        <button
                          type="button"
                          className={`rounded px-2 py-1 text-xs font-medium ${SIGNAL_CLASS[cell.signal]}`}
                          onClick={() =>
                            setDrawer({ mailboxId: row.mailboxId, gateway: cell.gateway })
                          }
                        >
                          {cell.signal === "insufficient_data" ? "—" : `${cell.deliverabilityPct}%`}
                        </button>
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
              {drawer?.gateway} — recent canary sends and arrival evidence
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {history?.items.map((item) => (
              <div key={item.id} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{item.seedEmail}</span>
                  <Badge variant="outline">{item.arrivalStatus}</Badge>
                </div>
                <p className="text-muted-foreground">{item.subject}</p>
                {item.arrivalGatewayHeaders ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(item.arrivalGatewayHeaders, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
