import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getPostalAddress, setPostalAddress } from "@/lib/organization.functions.ts";

export const Route = createFileRoute("/_protected/settings/compliance")({
  component: ComplianceSettingsPage,
});

function ComplianceSettingsPage() {
  const [postalAddress, setPostalAddress_] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getPostalAddress();
      setPostalAddress_(result.postalAddress);
      setSaved(result.postalAddress);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!postalAddress.trim()) return;
    setSaving(true);
    try {
      const result = await setPostalAddress({ data: { postalAddress: postalAddress.trim() } });
      setSaved(result.postalAddress);
      toast.success("Postal address updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const dirty = postalAddress.trim() !== saved;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6 fade-in">
      <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
        Compliance
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Business mailing address</CardTitle>
          <CardDescription>
            Required by CAN-SPAM. This address is included in the footer of every outbound email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="postal-address" className="text-[0.6875rem] font-medium">
              Postal address
            </Label>
            {loading ? (
              <div className="h-[80px] animate-pulse rounded-md bg-muted" />
            ) : (
              <Textarea
                id="postal-address"
                placeholder="123 Main St, Suite 100&#10;San Francisco, CA 94105"
                rows={3}
                value={postalAddress}
                onChange={(e) => setPostalAddress_(e.target.value)}
              />
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button
            size="sm"
            disabled={saving || !dirty || !postalAddress.trim()}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
