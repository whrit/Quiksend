import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listCrmConnections, updateFieldMapping } from "@/lib/crm.functions";
import { getProviderConfig } from "@quiksend/integrations/providers";
import type {
  CompanyField,
  CrmProvider,
  FieldMapping,
  ProspectField,
} from "@quiksend/integrations/providers";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_protected/settings/crm/$connectionId/mapping")({
  component: MappingPage,
  loader: async ({ params }) => {
    const connections = await listCrmConnections();
    const connection = connections.find((c) => c.id === params.connectionId);
    if (!connection) throw notFound();
    const defaults = getProviderConfig(connection.provider as CrmProvider).defaultFieldMapping;
    const mapping = connection.fieldMapping ?? defaults;
    return { connection, defaults, mapping };
  },
});

function MappingPage() {
  const { connection, defaults, mapping: initial } = Route.useLoaderData();
  const [mapping, setMapping] = useState<FieldMapping>(initial);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await updateFieldMapping({ data: { connectionId: connection.id, mapping } });
      toast.success("Field mapping saved");
    } catch {
      toast.error("Failed to save mapping");
    } finally {
      setSaving(false);
    }
  }

  function resetProspect(): void {
    setMapping((m) => ({ ...m, prospect: { ...defaults.prospect } }));
  }

  function resetCompany(): void {
    setMapping((m) => ({ ...m, company: { ...defaults.company } }));
  }

  const prospectFields = Object.keys(defaults.prospect) as ProspectField[];
  const companyFields = Object.keys(defaults.company) as CompanyField[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold capitalize">{connection.provider} field mapping</h1>
          <p className="text-muted-foreground text-sm">
            Map Quiksend fields to {connection.provider} property names.
          </p>
        </div>
        <Link to="/settings/crm" className={buttonVariants({ variant: "outline" })}>
          Back
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Prospect fields</CardTitle>
            <CardDescription>Left: Quiksend field. Right: CRM field name.</CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={resetProspect}>
            Reset to default
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {prospectFields.map((field) => (
            <div key={field} className="grid grid-cols-2 items-center gap-4">
              <Label className="font-mono text-sm">{field}</Label>
              <Input
                value={mapping.prospect[field] ?? ""}
                onChange={(e) =>
                  setMapping((m) => ({
                    ...m,
                    prospect: { ...m.prospect, [field]: e.target.value },
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Company fields</CardTitle>
            <CardDescription>Left: Quiksend field. Right: CRM field name.</CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={resetCompany}>
            Reset to default
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {companyFields.map((field) => (
            <div key={field} className="grid grid-cols-2 items-center gap-4">
              <Label className="font-mono text-sm">{field}</Label>
              <Input
                value={mapping.company[field] ?? ""}
                onChange={(e) =>
                  setMapping((m) => ({
                    ...m,
                    company: { ...m.company, [field]: e.target.value },
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button disabled={saving} onClick={() => void save()}>
        Save mapping
      </Button>
    </div>
  );
}
