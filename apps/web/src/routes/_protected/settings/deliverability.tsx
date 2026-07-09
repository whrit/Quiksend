import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  getWorkspaceCanaryConfig,
  setWorkspaceCanaryConfig,
} from "@/lib/deliverability.functions.ts";
import {
  getWorkspaceDeliverabilityPolicy,
  previewRoutingImpact,
  setWorkspaceDeliverabilityPolicy,
  type DeliverabilityPolicy,
  type RoutingImpactPreview,
  type RoutingPolicy,
} from "@/lib/organization.functions.ts";
import {
  createUserSeedInbox,
  deleteSeedInbox,
  isEntitledToProviderSeeds,
  listSeedInboxes,
  toggleSeedInboxActive,
  verifySeedInbox,
  type SeedInboxListItem,
} from "@/lib/seed-inbox.functions.ts";

export const Route = createFileRoute("/_protected/settings/deliverability")({
  component: DeliverabilitySettingsPage,
});

const ROUTING_POLICY_OPTIONS: Array<{ value: RoutingPolicy; label: string; description: string }> =
  [
    {
      value: "off",
      label: "Off",
      description:
        "No routing overrides. Sequences use the mailboxes you selected, regardless of gateway.",
    },
    {
      value: "warn",
      label: "Warn",
      description:
        "Show a banner in the compose UI when a selected mailbox looks unsafe for a recipient's SEG, but still send.",
    },
    {
      value: "enforce",
      label: "Enforce",
      description:
        "Skip sends when no enterprise-safe mailbox is available for the recipient's SEG. Safest, but drops volume.",
    },
  ];

function DeliverabilityRoutingSection() {
  const [policy, setPolicy] = useState<DeliverabilityPolicy | null>(null);
  const [preview, setPreview] = useState<RoutingImpactPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftRoutingPolicy, setDraftRoutingPolicy] = useState<RoutingPolicy>("off");
  const [draftSanitizer, setDraftSanitizer] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, i] = await Promise.all([
        getWorkspaceDeliverabilityPolicy(),
        previewRoutingImpact(),
      ]);
      setPolicy(p);
      setDraftRoutingPolicy(p.routingPolicy);
      setDraftSanitizer(p.contentSanitizerEnabled);
      setPreview(i);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirty =
    !!policy &&
    (policy.routingPolicy !== draftRoutingPolicy ||
      policy.contentSanitizerEnabled !== draftSanitizer);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setWorkspaceDeliverabilityPolicy({
        data: {
          routingPolicy: draftRoutingPolicy,
          contentSanitizerEnabled: draftSanitizer,
        },
      });
      toast.success("Routing policy saved");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="text-lg font-semibold">SEG routing policy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Controls how the sequence engine handles prospects on Proofpoint, Mimecast, Barracuda, and
          Cisco IronPort when your selected mailboxes are not enterprise-safe.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading policy…
        </div>
      ) : (
        <>
          <fieldset
            className="grid gap-2"
            role="radiogroup"
            aria-label="Routing policy"
            disabled={saving}
          >
            {ROUTING_POLICY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm hover:bg-muted/40 ${
                  draftRoutingPolicy === opt.value ? "border-primary bg-primary/5" : ""
                }`}
              >
                <input
                  type="radio"
                  name="routingPolicy"
                  value={opt.value}
                  checked={draftRoutingPolicy === opt.value}
                  onChange={() => setDraftRoutingPolicy(opt.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draftSanitizer}
              onChange={(e) => setDraftSanitizer(e.target.checked)}
              disabled={saving}
            />
            Enable content sanitizer for SEG-destined mail (strips tracking pixels + rewrites links)
          </label>

          {preview ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">Impact preview</div>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                <li>{preview.prospectsBehindSeg} prospects behind SEG gateways</li>
                <li>{preview.safeMailboxCount} enterprise-safe mailboxes available</li>
                {draftRoutingPolicy === "enforce" ? (
                  <li>
                    {preview.prospectsAtRiskOfSkip} prospects would be skipped under enforce today
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Save policy
            </Button>
            <Link
              to="/settings/mailboxes"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Manage mailboxes
            </Link>
            {policy?.routingPolicyChangedAt ? (
              <span className="text-xs text-muted-foreground">
                Last changed {new Date(policy.routingPolicyChangedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function SeedInboxesSection() {
  const [seeds, setSeeds] = useState<SeedInboxListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState({ entitled: false });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    imapHost: "localhost",
    imapPort: 1143,
    imapUsername: "",
    imapPassword: "",
    useSsl: false,
    gateway: "proofpoint",
    provider: "m365" as const,
    notes: "",
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, entitlement] = await Promise.all([
        listSeedInboxes(),
        isEntitledToProviderSeeds(),
      ]);
      setSeeds(list);
      setPro(entitlement);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load seed inboxes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate() {
    try {
      await createUserSeedInbox({ data: form });
      toast.success("Seed inbox created — verification queued");
      setModalOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create seed inbox");
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Seed inboxes</h2>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add seed inbox
        </Button>
      </div>
      {!pro.entitled && (
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
          Add 4 more SEGs (Proofpoint, Mimecast, Barracuda, Cisco) to your canary coverage with
          Deliverability Pro.
        </p>
      )}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Gateway</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {seeds.map((seed) =>
              seed.kind === "provider_pool_summary" ? (
                <TableRow key={`pool-${seed.gateway}`}>
                  <TableCell>
                    {seed.gateway.replace(/_/g, " ")} pool ({seed.count} seed
                    {seed.count === 1 ? "" : "s"})
                  </TableCell>
                  <TableCell>{seed.gateway}</TableCell>
                  <TableCell>(Quiksend-managed)</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>
                    <Badge variant="default">Active</Badge>
                  </TableCell>
                  <TableCell />
                </TableRow>
              ) : (
                <TableRow key={seed.id}>
                  <TableCell>{seed.email}</TableCell>
                  <TableCell>{seed.gateway}</TableCell>
                  <TableCell>{seed.provider}</TableCell>
                  <TableCell>
                    {seed.verifiedAt ? `✅ ${seed.verifiedAt.slice(0, 10)}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={seed.active ? "default" : "secondary"}>
                      {seed.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void verifySeedInbox({ data: { seedInboxId: seed.id } }).then(() =>
                          toast.success("Re-verification queued"),
                        )
                      }
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void toggleSeedInboxActive({
                          data: { seedInboxId: seed.id, active: !seed.active },
                        }).then(reload)
                      }
                    >
                      {seed.active ? "Pause" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void deleteSeedInbox({ data: { seedInboxId: seed.id } }).then(reload)
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add seed inbox</DialogTitle>
            <DialogDescription>
              IMAP credentials are encrypted at rest. Mailpit local IMAP: localhost:1143.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>IMAP host</Label>
                <Input
                  value={form.imapHost}
                  onChange={(e) => setForm((f) => ({ ...f, imapHost: e.target.value }))}
                />
              </div>
              <div>
                <Label>Port</Label>
                <Input
                  type="number"
                  value={form.imapPort}
                  onChange={(e) => setForm((f) => ({ ...f, imapPort: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div>
              <Label>Username</Label>
              <Input
                value={form.imapUsername}
                onChange={(e) => setForm((f) => ({ ...f, imapUsername: e.target.value }))}
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                value={form.imapPassword}
                onChange={(e) => setForm((f) => ({ ...f, imapPassword: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleCreate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CanaryConfigSection() {
  const [config, setConfig] = useState({
    enabled: true,
    seedsPerCampaign: 3,
    pauseThresholdPct: 80,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getWorkspaceCanaryConfig().then(setConfig);
  }, []);

  async function save() {
    setSaving(true);
    try {
      const next = await setWorkspaceCanaryConfig({ data: config });
      setConfig(next);
      toast.success("Canary settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Canary policy</h2>
      <div className="mt-4 grid max-w-md gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
          />
          Enable canary injection on enrollment
        </label>
        <div>
          <Label>Seeds per campaign</Label>
          <Input
            type="number"
            value={config.seedsPerCampaign}
            onChange={(e) => setConfig((c) => ({ ...c, seedsPerCampaign: Number(e.target.value) }))}
          />
        </div>
        <div>
          <Label>Auto-pause threshold (%)</Label>
          <Input
            type="number"
            value={config.pauseThresholdPct}
            onChange={(e) =>
              setConfig((c) => ({ ...c, pauseThresholdPct: Number(e.target.value) }))
            }
          />
        </div>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          Save canary policy
        </Button>
      </div>
    </section>
  );
}

function DeliverabilitySettingsPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
        Deliverability settings
      </h1>
      <DeliverabilityRoutingSection />
      {/* === Phase 11C Canary section (PHI extends here) === */}
      <SeedInboxesSection />
      <CanaryConfigSection />
      {/* === End Phase 11C === */}
    </div>
  );
}
