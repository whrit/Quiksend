import { Link, createFileRoute } from "@tanstack/react-router";
import { Download, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  type ProspectCsvField,
  parseCsvHeaders,
  parseCsvStream,
} from "@/lib/prospect-import.ts";
import { getImportBatch, startImport } from "@/lib/prospects.functions.ts";

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
  const [parsed, setParsed] = useState<Awaited<ReturnType<typeof parseCsvStream>> | null>(null);
  const [dedupePolicy, setDedupePolicy] = useState<DedupePolicy>("skip_existing");
  const [importing, setImporting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<Awaited<ReturnType<typeof getImportBatch>> | null>(
    null,
  );

  const previewRows = useMemo(() => parsed?.valid.slice(0, 5) ?? [], [parsed]);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
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
  }, []);

  const onMappingNext = async () => {
    if (!file) return;
    localStorage.setItem(
      mappingStorageKey("default", hashHeaders(headers)),
      JSON.stringify(mapping),
    );
    const result = await parseCsvStream(file, mapping);
    setParsed(result);
    setStep(3);
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
      setBatchResult(full);
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
          <h1 className="text-2xl font-semibold">Import prospects</h1>
          <p className="text-sm text-muted-foreground">Step {step} of 5</p>
        </div>
        <Link to="/prospects" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Back to prospects
        </Link>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Upload CSV</CardTitle>
            <CardDescription>Accepts .csv files. Large files stream row-by-row.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 hover:bg-muted/40">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Drop a CSV here or click to browse
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
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Map columns</CardTitle>
            <CardDescription>
              Map each CSV column to a prospect or company field, or ignore it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => void onMappingNext()}>Preview</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && parsed && (
        <Card>
          <CardHeader>
            <CardTitle>Preview & validation</CardTitle>
            <CardDescription>
              {parsed.valid.length} valid · {parsed.invalid.length} invalid
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Badge>{parsed.valid.length} valid</Badge>
              <Badge variant={parsed.invalid.length ? "destructive" : "secondary"}>
                {parsed.invalid.length} invalid
              </Badge>
            </div>
            {parsed.invalid.length > 0 && (
              <ul className="max-h-32 overflow-auto rounded border p-3 text-sm">
                {parsed.invalid.slice(0, 10).map((row) => (
                  <li key={row.rowNumber}>
                    Row {row.rowNumber}: {row.reason}
                  </li>
                ))}
              </ul>
            )}
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
                      {[row.prospect.firstName, row.prospect.lastName].filter(Boolean).join(" ")}
                    </TableCell>
                    <TableCell>{row.company?.name ?? row.company?.domain ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={() => setStep(4)}>Continue</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm import</CardTitle>
            <CardDescription>
              Importing {parsed?.valid.length ?? 0} rows from {file?.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                {importing ? "Importing…" : "Run import"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {batchResult?.status === "completed" ? "Import complete" : "Import in progress"}
            </CardTitle>
            <CardDescription>
              {batchId ? `Batch ${batchId}` : "Waiting for batch status…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {batchResult ? (
              <>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="text-lg font-semibold">{batchResult.createdCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd className="text-lg font-semibold">{batchResult.updatedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Skipped</dt>
                    <dd className="text-lg font-semibold">{batchResult.skippedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Errors</dt>
                    <dd className="text-lg font-semibold">{batchResult.erroredCount}</dd>
                  </div>
                </dl>
                {batchResult.errors.length > 0 && (
                  <Button variant="outline" onClick={downloadErrors}>
                    <Download className="mr-2 h-4 w-4" />
                    Download error CSV
                  </Button>
                )}
                {batchResult.status === "completed" && (
                  <Link to="/prospects" className={buttonVariants()}>
                    View prospects
                  </Link>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Processing import batch…</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
