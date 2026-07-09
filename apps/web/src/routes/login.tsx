import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: LoginPage });

const schema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8, "At least 8 characters"),
});
type FormValues = z.infer<typeof schema>;

const HEADLINES = [
  { hd: "The last outbound tool", it: "your team learns." },
  { hd: "Sequences with the taste", it: "of a hand-written note." },
  { hd: "Deliverability, actually", it: "monitored." },
];

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [headline] = useState(() => HEADLINES[Math.floor(Math.random() * HEADLINES.length)]!);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const res =
      mode === "signin"
        ? await authClient.signIn.email({ email: values.email, password: values.password })
        : await authClient.signUp.email({
            email: values.email,
            password: values.password,
            name: values.name?.trim() || values.email,
          });
    if (res.error) {
      setError(res.error.message ?? "Something went wrong");
      return;
    }
    await navigate({ to: "/dashboard" });
  });

  const social = (provider: "google" | "microsoft") =>
    authClient.signIn.social({ provider, callbackURL: "/dashboard" });

  return (
    <div className="grain relative min-h-screen bg-background text-foreground">
      <div className="relative z-[2] grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
        {/* ─── Editorial masthead ────────────────────────────────────────── */}
        <div
          className="relative hidden overflow-hidden border-r border-border p-10 lg:flex lg:flex-col"
          style={{ background: "var(--card)" }}
        >
          {/* Concentric mark */}
          <div className="pointer-events-none absolute -left-24 -top-24 opacity-[0.05]">
            <svg width="520" height="520" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="0.15" />
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="0.15" />
              <circle cx="50" cy="50" r="32" stroke="currentColor" strokeWidth="0.15" />
              <circle cx="50" cy="50" r="24" stroke="currentColor" strokeWidth="0.15" />
              <circle cx="50" cy="50" r="16" stroke="currentColor" strokeWidth="0.15" />
              <circle cx="50" cy="50" r="8" stroke="currentColor" strokeWidth="0.15" />
            </svg>
          </div>
          {/* Amber punctuation */}
          <div
            aria-hidden
            className="pointer-events-none absolute right-16 top-16 h-24 w-24 rounded-full opacity-[0.08]"
            style={{ background: "var(--amber-600)" }}
          />

          <div className="relative flex items-center gap-2">
            <span
              className="grid h-6 w-6 place-items-center rounded font-mono text-[0.6875rem] text-white"
              style={{ background: "var(--ink-950)" }}
            >
              Q
            </span>
            <span className="font-display text-[1.125rem] leading-none">Quiksend</span>
          </div>

          <div className="relative mt-auto max-w-lg">
            <div className="micro-label">Vol. 1 · Issue No. 26</div>
            <h1 className="mt-3 font-display text-[3.75rem] leading-[0.95] tracking-[-0.03em]">
              {headline.hd}{" "}
              <span className="font-display-italic text-[color:var(--amber-600)]">
                {headline.it}
              </span>
            </h1>
            <p className="mt-6 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
              An open-source outbound platform. Sequences, prospects, mailboxes, AI research, and
              enterprise deliverability — all in one editorial workspace.
            </p>
          </div>

          <div className="relative mt-10 flex items-center justify-between border-t border-border pt-6">
            <div className="text-[0.6875rem] tabular text-muted-foreground">
              Est. <span className="font-mono">2026</span>
            </div>
            <div className="font-display-italic text-[0.875rem] text-muted-foreground">
              Composed with care.
            </div>
          </div>
        </div>

        {/* ─── Form ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            <div className="mb-8 lg:hidden">
              <span className="font-display text-[1.5rem]">Quiksend</span>
            </div>

            <div className="micro-label">{mode === "signin" ? "Welcome back" : "New account"}</div>
            <h2 className="mt-1 font-display text-[2rem] leading-[1] tracking-[-0.02em]">
              {mode === "signin" ? "Sign in" : "Create your account"}
            </h2>
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              {mode === "signin"
                ? "Access your workspace, sequences, and inbox."
                : "Create your workspace after signing up in a single step."}
            </p>

            <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-3.5">
              {mode === "signup" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name" className="micro-label">
                    Name
                  </Label>
                  <Input id="name" placeholder="Ada Lovelace" {...register("name")} />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email" className="micro-label">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-[0.6875rem] text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password" className="micro-label">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="········"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-[0.6875rem] text-destructive">{errors.password.message}</p>
                )}
              </div>
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
                disabled={isSubmitting}
              >
                {isSubmitting ? "…" : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <div className="relative my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                or
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void social("google")}
              >
                Continue with Google
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void social("microsoft")}
              >
                Continue with Microsoft
              </Button>
            </div>

            <div className="mt-8 text-center text-[0.75rem] text-muted-foreground">
              {mode === "signin" ? "Don't have an account?" : "Already have one?"}{" "}
              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
