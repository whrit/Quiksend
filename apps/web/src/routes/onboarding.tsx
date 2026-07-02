import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { getSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/login" });
    }
    if (session.session.activeOrganizationId) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createWorkspace = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const result = await authClient.organization.create({ name: name.trim(), slug });
    if (result.error) {
      setError(result.error.message ?? "Failed to create workspace");
      setCreating(false);
      return;
    }
    if (result.data?.id) {
      await authClient.organization.setActive({ organizationId: result.data.id });
    }
    await navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your first workspace</CardTitle>
          <CardDescription>
            Quiksend organizes prospects, sequences, and mailboxes inside a workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={creating || !name.trim()} onClick={() => void createWorkspace()}>
            {creating ? "Creating…" : "Create workspace"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
