import { Link, createFileRoute } from "@tanstack/react-router";
import { Download, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Absent, EmptyState, Pill, SkeletonRows } from "@/components/ui/primitives.tsx";
import { Button, buttonVariants } from "@/components/ui/button";
import { Panel } from "@/components/ui/primitives.tsx";
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
  type CsvColumnMapping,
  type DedupePolicy,
  type ParseCsvResult,
  type ProspectCsvField,
  parseCsvHeaders,
  parseCsvStream,
} from "@/lib/prospect-import.ts";
import { getImportBatch, startImport } from "@/lib/prospects.functions.ts";

/* Minimal shape of the import batch result — what we render. */
interface ImportBatchResult {
  id: string;
  status: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  erroredCount: number;
  errors: Array<{ id: string; rowNumber: number; reason: string; raw: Record<string, string> }>;
}

const FIELD_OPTIONS: { value: ProspectCsvField; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "email", label: "Email" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "title", label: "Title" },
  { value: "phone", label: "Phone" },
  { value: "linkedinUrl", label: "LinkedIn URL" },
  { value: "timezone", label: "Timezone" },
  { value: "companyName", label: "Company name" },
  { value: "companyDomain", label: "Company domain" },
  { value: "companyIndustry", label: "Company industry" },
  { value: "companyWebsite", label: "Company website" },
];

function hashHeaders(headers: string[]): string {
  return headers.toSorted().join("|");
}

function mappingStorageKey(orgKey: string, headerHash: string): string {
  return `quiksend:csv-mapping:${orgKey}:${headerHash}`;
}

export const Route = createFileRoute("/_protected/prospects/import")({
  component: ImportPage,
});

function ImportPage() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [parsed, setParsed] = useState<ParseCsvResult | null>(null);
  const [dedupePolicy, setDedupePolicy] = useState<DedupePolicy>("skip_existing");
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<ImportBatchResult | null>(null);

  const previewRows = useMemo(() => parsed?.valid.slice(0, 5) ?? [], [parsed]);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    setUploading(true);
    try {
      const cols = await parseCsvHeaders(f);
      setHeaders(cols);
      const headerHash = hashHeaders(cols);
      const stored = localStorage.getItem(mappingStorageKey("default", headerHash));
      const initial: CsvColumnMapping = {};
      if (stored) {
        Object.assign(initial, JSON.parse(stored) as CsvColumnMapping);
      } else {
        for (const col of cols) {
          const lower = col.toLowerCase();
          if (lower.includes("email")) initial[col] = "email";
          else if (lower.includes("first")) initial[col] = "firstName";
          else if (lower.includes("last")) initial[col] = "lastName";
          else if (lower.includes("title") || lower.includes("job")) initial[col] = "title";
          else if (lower.includes("company") && lower.includes("domain"))
            initial[col] = "companyDomain";
          else if (lower.includes("company")) initial[col] = "companyName";
          else initial[col] = "ignore";
        }
      }
      setMapping(initial);
      setStep(2);
    } finally {
      setUploading(false);
    }
  }, []);

  const onMappingNext = async () => {
    if (!file) return;
    localStorage.setItem(
      mappingStorageKey("default", hashHeaders(headers)),
      JSON.stringify(mapping),
    );
    setValidating(true);
    try {
      const result = await parseCsvStream(file, mapping);
      setParsed(result);
      setStep(3);
    } finally {
      setValidating(false);
    }
  };

  const onImport = async () => {
    if (!file || !parsed) return;
    setImporting(true);
    try {
      const result = await startImport({
        data: {
          filename: file.name,
          mapping,
          rows: parsed.valid,
          invalidRows: parsed.invalid,
          dedupePolicy,
        },
      });
      setBatchId(result.batch.id);
      setStep(5);
      toast.success("Import queued");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;

    const poll = async () => {
      const full = await getImportBatch({ data: { id: batchId } });
      if (cancelled) return;
      setBatchResult(full as ImportBatchResult);
      if (full.status === "completed" || full.status === "failed") {
        if (full.status === "completed") toast.success("Import complete");
        else toast.error("Import failed");
        return;
      }
      window.setTimeout(() => void poll(), 1500);
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const downloadErrors = () => {
    if (!batchResult?.errors.length) return;
    const lines = ["row_number,reason,raw"];
    for (const err of batchResult.errors) {
      lines.push(
        `${err.rowNumber},"${err.reason.replace(/"/g, '""')}","${JSON.stringify(err.raw).replace(/"/g, '""')}"`,
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-errors-${batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="micro-label">CSV Import</div>
          <h1 className="mt-0.5 text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            Import prospects
          </h1>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">Step {step} of 5</p>
        </div>
        <Link to="/prospects" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Back to prospects
        </Link>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <Panel title="Upload CSV">
          <div className="p-4">
            {uploading ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Reading file…</span>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 hover:bg-muted/40">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Drop a CSV here or click to browse
                </span>
                <span className="text-xs text-muted-foreground">
                  .csv files · large files stream row-by-row
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
              </label>
            )}
          </div>
        </Panel>
      )}

      {/* Step 2: Map columns */}
      {step === 2 && (
        <Panel title="Map columns">
          <div className="p-4 space-y-4">
            <p className="text-[0.75rem] text-muted-foreground">
              Map each CSV column to a prospect or company field, or mark it as ignored.
            </p>
            {validating ? (
              <SkeletonRows rows={headers.length} cols={2} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CSV column</TableHead>
                    <TableHead>Maps to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {headers.map((col) => (
                    <TableRow key={col}>
                      <TableCell className="font-medium">{col}</TableCell>
                      <TableCell>
                        <Select
                          value={mapping[col] ?? "ignore"}
                          onValueChange={(v) =>
                            setMapping((m) => ({ ...m, [col]: v as ProspectCsvField }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button disabled={validating} onClick={() => void onMappingNext()}>
                {validating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Validating…
                  </>
                ) : (
                  "Preview"
                )}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 3: Preview & validation */}
      {step === 3 && parsed && (
        <Panel title="Preview & validation">
          <div className="p-4 space-y-4">
            {/* Summary row */}
            <div className="flex gap-2">
              <Pill tone="pos" dot>
                {parsed.valid.length} valid
              </Pill>
              {parsed.invalid.length > 0 ? (
                <Pill tone="neg" dot>
                  {parsed.invalid.length} invalid
                </Pill>
              ) : null}
            </div>

            {/* Invalid rows — all shown, each marked with the reason and affected column */}
            {parsed.invalid.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[0.75rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Rows with errors
                </h3>
                <div className="overflow-x-auto rounded-[var(--radius-md)] border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Row</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead>Raw values</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsed.invalid.map((row) => (
                        <TableRow key={row.rowNumber} data-row-error="true">
                          <TableCell className="tabular-nums text-muted-foreground">
                            {row.rowNumber}
                          </TableCell>
                          <TableCell>
                            <span style={{ color: "var(--neg)" }}>{row.reason}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(row.raw)
                                .filter(([, v]) => v)
                                .slice(0, 4)
                                .map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="rounded-[var(--radius-sm)] bg-muted px-1.5 py-0.5 text-xs"
                                    title={`${k}: ${v}`}
                                  >
                                    <span className="text-muted-foreground">{k}:</span>{" "}
                                    <span className="max-w-[12ch] truncate inline-block align-bottom">
                                      {v}
                                    </span>
                                  </span>
                                ))}
                              {Object.keys(row.raw).filter((k) => row.raw[k]).length > 4 ? (
                                <span className="text-xs text-muted-foreground">
                                  +{Object.keys(row.raw).filter((k) => row.raw[k]).length - 4} more
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-[0.75rem] text-muted-foreground">
                  These rows will be skipped. Fix the CSV and re-upload, or continue with only the
                  valid rows.
                </p>
              </div>
            )}

            {/* Valid rows preview */}
            {parsed.valid.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-[0.75rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview (first {previewRows.length} of {parsed.valid.length})
                </h3>
                <div className="overflow-x-auto rounded-[var(--radius-md)] border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Company</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell>{row.prospect.email}</TableCell>
                          <TableCell>
                            {[row.prospect.firstName, row.prospect.lastName]
                              .filter(Boolean)
                              .join(" ") || <Absent>No name</Absent>}
                          </TableCell>
                          <TableCell>
                            {row.company?.name ?? row.company?.domain ?? (
                              <Absent>No company</Absent>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No valid rows found"
                body="Check your column mapping — the email column must be mapped and contain valid email addresses."
              />
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button disabled={parsed.valid.length === 0} onClick={() => setStep(4)}>
                Continue
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 4: Confirm import */}
      {step === 4 && (
        <Panel title="Confirm import">
          <div className="p-4 space-y-4">
            <p className="text-[0.75rem] text-muted-foreground">
              Importing{" "}
              <span className="tabular-nums font-medium">{parsed?.valid.length ?? 0}</span> rows
              from <span className="font-medium">{file?.name}</span>
              {parsed && parsed.invalid.length > 0 ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="tabular-nums" style={{ color: "var(--warn)" }}>
                    {parsed.invalid.length} invalid rows will be skipped
                  </span>
                </>
              ) : null}
            </p>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Duplicate policy</span>
              <Select
                value={dedupePolicy}
                onValueChange={(v) => setDedupePolicy(v as DedupePolicy)}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip_existing">Skip existing emails</SelectItem>
                  <SelectItem value="update_existing">Update existing emails</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button disabled={importing} onClick={() => void onImport()}>
                {importing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  "Run import"
                )}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 5: Progress / result */}
      {step === 5 && (
        <Panel
          title={
            batchResult?.status === "completed"
              ? "Import complete"
              : batchResult?.status === "failed"
                ? "Import failed"
                : "Import in progress"
          }
        >
          <div className="p-4 space-y-4">
            {!batchResult ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Processing import batch…</p>
              </div>
            ) : (
              <>
                <div className="hair-grid grid-cols-4">
                  {(
                    [
                      { label: "Created", value: batchResult.createdCount, tone: "pos" },
                      { label: "Updated", value: batchResult.updatedCount, tone: "brand" },
                      { label: "Skipped", value: batchResult.skippedCount, tone: "neutral" },
                      { label: "Errors", value: batchResult.erroredCount, tone: "neg" },
                    ] as const
                  ).map(({ label, value, tone }) => (
                    <div key={label} className="p-3">
                      <p
                        className="text-[1.25rem] font-semibold tabular-nums leading-tight"
                        style={{ color: value > 0 ? `var(--${tone})` : "var(--paper-400)" }}
                      >
                        {value}
                      </p>
                      <p className="text-[0.75rem] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Batch-level errors from the server */}
                {batchResult.errors.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[0.75rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        Row errors
                      </h3>
                      <Button size="sm" variant="outline" onClick={downloadErrors}>
                        <Download className="mr-1 h-3 w-3" />
                        Download CSV
                      </Button>
                    </div>
                    <div className="max-h-64 overflow-auto rounded-[var(--radius-md)] border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">Row</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {batchResult.errors.map((err) => (
                            <TableRow key={err.id} data-row-error="true">
                              <TableCell className="tabular-nums text-muted-foreground">
                                {err.rowNumber}
                              </TableCell>
                              <TableCell style={{ color: "var(--neg)" }}>{err.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {batchResult.status === "completed" && (
                  <div className="flex gap-2">
                    <Link to="/prospects" className={buttonVariants()}>
                      View prospects
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
