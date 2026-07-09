import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
    <div className="grain relative flex min-h-screen items-center justify-center bg-background p-6">
      <div className="relative z-[2] w-full max-w-lg">
        <div className="paper rise relative overflow-hidden p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full opacity-[0.08]"
            style={{ background: "var(--amber-600)" }}
          />
          <div className="pointer-events-none absolute -left-16 -bottom-16 opacity-[0.04]">
            <svg width="220" height="220" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="0.3" />
              <circle cx="50" cy="50" r="34" stroke="currentColor" strokeWidth="0.3" />
              <circle cx="50" cy="50" r="20" stroke="currentColor" strokeWidth="0.3" />
            </svg>
          </div>
          <div className="relative">
            <div className="micro-label">Step 01 · Name your workspace</div>
            <h1 className="mt-3 font-display text-[2.75rem] leading-[0.95] tracking-[-0.03em]">
              A workspace is where{" "}
              <span className="font-display-italic text-[color:var(--amber-600)]">
                everything begins
              </span>
              .
            </h1>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Prospects, sequences, mailboxes, inbox — all scoped to a workspace. Most teams use one
              per company or per product line.
            </p>

            <form
              className="mt-8 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void createWorkspace();
              }}
            >
              <div className="micro-label">Workspace name</div>
              <Input
                // oxlint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                placeholder="Acme Corp · Q4 outbound"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-[1rem] h-11 px-3"
              />
              {error && (
                <div className="rounded-md border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/[0.04] px-3 py-2 text-[0.75rem] text-[color:var(--destructive)]">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                variant="accent"
                size="lg"
                className="mt-2 w-full"
                disabled={creating || !name.trim()}
              >
                {creating ? "Creating…" : "Create workspace →"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
