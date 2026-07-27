import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Absent, EmptyState, SkeletonRows } from "@/components/ui/primitives.tsx";
import { formatDate, formatRelative } from "@/lib/semantic.ts";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys.functions.ts";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/settings/api-keys/")({
  component: ApiKeysPage,
});

type ApiKeyRow = Awaited<ReturnType<typeof listApiKeys>>[number];

function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setKeys(await listApiKeys({ data: {} }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await createApiKey({ data: { name: name.trim() } });
      setCreatedKey(result.key);
      setName("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApiKey({ data: { keyId: revokeTarget.id } });
      await reload();
      toast.success("API key revoked");
      setRevokeTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setRevoking(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 fade-in w-full min-w-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            API keys
          </h1>
          <p className="text-sm text-muted-foreground">
            Programmatic access to the public REST API for this workspace.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create key
        </Button>
      </div>

      {loading ? (
        <div className="panel overflow-hidden">
          <SkeletonRows rows={3} cols={4} />
        </div>
      ) : keys.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<KeyRound className="h-5 w-5" />}
            hue="brand"
            title="No API keys yet"
            body="Create a key to authenticate programmatic access to the REST API."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create key
              </Button>
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">
                  {key.name ?? <Absent>Untitled</Absent>}
                </TableCell>
                <TableCell>
                  {key.prefix ? (
                    <code className="font-mono text-xs">{key.prefix}…</code>
                  ) : (
                    <Absent />
                  )}
                </TableCell>
                <TableCell>
                  <span title={formatDate(key.createdAt) ?? undefined}>
                    {formatRelative(key.createdAt) ?? <Absent />}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-[color:var(--neg)]"
                    aria-label={`Revoke API key ${key.name ?? key.prefix ?? key.id}`}
                    onClick={() => setRevokeTarget(key)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-sm text-muted-foreground">
        API docs:{" "}
        <a className="text-sm text-primary underline" href="/api/v1/openapi.json">
          OpenAPI spec
        </a>
      </p>

      {/* ── Create key dialog ────────────────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setCreatedKey(null);
            setName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createdKey ? "Copy your new API key" : "Create API key"}</DialogTitle>
          </DialogHeader>

          {createdKey ? (
            <div className="space-y-4">
              {/* "Once only" reveal panel */}
              <div className="rounded-md border border-[color:var(--warn)] bg-[color:var(--warn-tint)] p-4">
                <p className="mb-2 text-[0.8125rem] font-semibold text-[color:var(--warn)]">
                  You won&apos;t see this key again
                </p>
                <p className="mb-3 text-[0.75rem] text-muted-foreground">
                  Copy it now and store it somewhere secure (a password manager or secrets vault).
                  Once you close this dialog the full key is gone — only the prefix remains visible
                  in the table.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={createdKey}
                    className="font-mono text-xs"
                    onFocus={(e) => e.target.select()}
                    aria-label="API key — copy this now"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Copy API key to clipboard"
                    onClick={() => void handleCopy()}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-[color:var(--pos)]" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="key-name" className="text-[0.8125rem] font-semibold">
                  Name <span className="text-[color:var(--neg)]">*</span>
                </Label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Production integration"
                  onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
                />
                <p className="text-[0.6875rem] text-muted-foreground">
                  Describe what this key is for — you can&apos;t rename it later.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            {createdKey ? (
              <Button
                onClick={() => {
                  setCreatedKey(null);
                  setCreateOpen(false);
                }}
              >
                Done — I&apos;ve copied the key
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={busy || !name.trim()} onClick={() => void handleCreate()}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Create key
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke confirmation dialog ───────────────────────────────────── */}
      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API key?</DialogTitle>
            <DialogDescription>
              <strong>{revokeTarget?.name ?? revokeTarget?.prefix}</strong> will stop working
              immediately. Any integrations using it will fail until you create a new key.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={revoking} onClick={() => void confirmRevoke()}>
              {revoking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
