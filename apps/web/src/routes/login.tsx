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
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});
type FormValues = z.infer<typeof schema>;

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
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
      setError(res.error.message ?? "Something went wrong. Please try again.");
      return;
    }
    await navigate({ to: "/dashboard" });
  });

  const social = (provider: "google" | "microsoft") =>
    authClient.signIn.social({ provider, callbackURL: "/dashboard" });

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <div className="w-full max-w-[340px]">
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

        <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-1.5 text-[0.75rem] text-muted-foreground">
          {mode === "signin"
            ? "Access your workspace, sequences, and inbox."
            : "You'll create your first workspace next."}
        </p>

        <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-3">
          {mode === "signup" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="name" className="text-[0.6875rem] font-medium">
                Name
              </Label>
              <Input id="name" placeholder="Ada Lovelace" {...register("name")} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="email" className="text-[0.6875rem] font-medium">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-[0.6875rem] text-destructive">{errors.email.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password" className="text-[0.6875rem] font-medium">
                Password
              </Label>
              {mode === "signin" && (
                <button
                  type="button"
                  className="text-[0.6875rem] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
                  onClick={(e) => e.preventDefault()}
                >
                  Forgot?
                </button>
              )}
            </div>
            <Input
              id="password"
              type="password"
              placeholder="8 characters or more"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              {...register("password")}
            />
            {errors.password && (
              <p className="text-[0.6875rem] text-destructive">{errors.password.message}</p>
            )}
          </div>
          {error && (
            <div className="rounded-[4px] border border-[color:var(--status-red-600)]/30 bg-[color:var(--status-red-050)] px-2.5 py-1.5 text-[0.6875rem] text-[color:var(--status-red-600)]">
              {error}
            </div>
          )}
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={isSubmitting}>
            {isSubmitting
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </Button>
        </form>

        <div className="relative my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.02em] text-muted-foreground">
            or
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="flex flex-col gap-1.5">
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

        <div className="mt-8 text-center text-[0.6875rem] text-muted-foreground">
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
  );
}
