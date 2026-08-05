import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { getOnboardingContext } from "@/lib/auth.functions.ts";
import { Tile } from "@/components/ui/primitives.tsx";
import { setPostalAddress } from "@/lib/organization.functions.ts";

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
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [postalAddress, setPostalAddress_] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
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
        setError(activeResult.error.message ?? "Workspace created but couldn't switch to it");
        setCreating(false);
        return;
      }
      setOrgId(result.data.id);
    }
    setCreating(false);
    setStep(2);
  };

  const savePostalAddress = async () => {
    if (!postalAddress.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await setPostalAddress({ data: { postalAddress: postalAddress.trim() } });
      await navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save address");
      setCreating(false);
    }
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

        {removedFromWorkspace && step === 1 && (
          <div className="mb-4 rounded-[4px] border border-[color:var(--status-red-600)]/30 bg-[color:var(--status-red-050)] px-2.5 py-2 text-[0.75rem] leading-relaxed text-[color:var(--status-red-600)]">
            You no longer have access to your previous workspace. Create a new one below or ask an
            admin to send you a fresh invite.
          </div>
        )}

        <div className="flex items-center gap-2">
          <Tile size="xs" hue="brand">
            {step}
          </Tile>
          <span className="micro-label">Step {step} of 2</span>
        </div>

        {step === 1 ? (
          <>
            <h1 className="mt-2 text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">
              Name your workspace
            </h1>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">
              Prospects, sequences, mailboxes, and the inbox all belong to one workspace. Most teams
              use one per company or per product line.
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
          </>
        ) : (
          <>
            <h1 className="mt-2 text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">
              Business mailing address
            </h1>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">
              Required by CAN-SPAM. This address appears in every outbound email footer.
            </p>

            <form
              className="mt-6 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void savePostalAddress();
              }}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="postal-address" className="text-[0.6875rem] font-medium">
                  Postal address
                </Label>
                <Textarea
                  id="postal-address"
                  // oxlint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  placeholder="123 Main St, Suite 100&#10;San Francisco, CA 94105"
                  rows={3}
                  value={postalAddress}
                  onChange={(e) => setPostalAddress_(e.target.value)}
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
                disabled={creating || !postalAddress.trim()}
              >
                {creating ? "Saving…" : "Finish setup"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
