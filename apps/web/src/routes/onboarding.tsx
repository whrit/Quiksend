import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { getOnboardingContext } from "@/lib/protected-guard.ts";

const onboardingSearchSchema = z.object({
  removed: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search) => onboardingSearchSchema.parse(search),
  beforeLoad: async () => {
    const prep = await getOnboardingContext();
    if (prep.action === "redirect") {
      throw redirect({ to: prep.to });
    }
    return { removedFromWorkspace: prep.removedFromWorkspace };
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const { removed } = Route.useSearch();
  const routeContext = Route.useRouteContext();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removedFromWorkspace = routeContext.removedFromWorkspace || removed;

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
      setError(result.error.message ?? "Couldn't create workspace. Please try again.");
      setCreating(false);
      return;
    }
    if (result.data?.id) {
      const activeResult = await authClient.organization.setActive({
        organizationId: result.data.id,
      });
      if (activeResult.error) {
        setError(
          activeResult.error.message ?? "Workspace created but couldn't switch to it",
        );
        setCreating(false);
        return;
      }
    }
    await navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-1.5 pb-8">
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded-[3px] font-mono text-[0.625rem] text-white"
            style={{ background: "var(--paper-900)" }}
          >
            Q
          </span>
          <span className="text-[0.9375rem] font-semibold tracking-[-0.015em]">Quiksend</span>
        </div>

        {removedFromWorkspace && (
          <div className="mb-4 rounded-[4px] border border-[color:var(--status-red-600)]/30 bg-[color:var(--status-red-050)] px-2.5 py-2 text-[0.75rem] leading-relaxed text-[color:var(--status-red-600)]">
            You no longer have access to your previous workspace. Create a new one below or ask an
            admin to send you a fresh invite.
          </div>
        )}

        <div className="micro-label">Step 1 of 1</div>
        <h1 className="mt-1 text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">
          Name your workspace
        </h1>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">
          Prospects, sequences, mailboxes, and the inbox all belong to one workspace. Most teams use
          one per company or per product line.
        </p>

        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void createWorkspace();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="workspace-name" className="text-[0.6875rem] font-medium">
              Workspace name
            </Label>
            <Input
              id="workspace-name"
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="Acme Q4 outbound"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-[4px] border border-[color:var(--status-red-600)]/30 bg-[color:var(--status-red-050)] px-2.5 py-1.5 text-[0.6875rem] text-[color:var(--status-red-600)]">
              {error}
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            className="mt-1 w-full"
            disabled={creating || !name.trim()}
          >
            {creating ? "Creating…" : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
