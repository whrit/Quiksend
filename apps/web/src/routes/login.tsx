import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const loginSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: (search) => loginSearchSchema.parse(search),
  component: LoginPage,
});

const schema = z.object({
  name: z.string().optional(),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

const forgotSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

const resetSchema = z.object({
  password: z.string().min(8, "At least 8 characters"),
  confirmPassword: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;
type ForgotValues = z.infer<typeof forgotSchema>;
type ResetValues = z.infer<typeof resetSchema>;

function LoginPage() {
  const navigate = useNavigate();
  const { token, error: resetError } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">(
    token ? "reset" : "signin",
  );
  const [error, setError] = useState<string | null>(resetError ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const forgotForm = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema) });
  const resetForm = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setInfo(null);
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

  const onForgotSubmit = forgotForm.handleSubmit(async (values) => {
    setError(null);
    setInfo(null);
    const redirectTo = `${window.location.origin}/login`;
    const res = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo,
    });
    if (res.error) {
      setError(res.error.message ?? "Couldn't send reset email. Please try again.");
      return;
    }
    setInfo("If an account exists for that email, we sent a reset link.");
  });

  const onResetSubmit = resetForm.handleSubmit(async (values) => {
    if (!token) {
      setError("Reset link is invalid or expired.");
      return;
    }
    if (values.password !== values.confirmPassword) {
      resetForm.setError("confirmPassword", { message: "Passwords do not match" });
      return;
    }
    setError(null);
    setInfo(null);
    const res = await authClient.resetPassword({
      newPassword: values.password,
      token,
    });
    if (res.error) {
      setError(res.error.message ?? "Couldn't reset password. The link may have expired.");
      return;
    }
    setInfo("Password updated. You can sign in now.");
    resetForm.reset();
    void navigate({ to: "/login", search: {} });
    setMode("signin");
  });

  const social = (provider: "google" | "microsoft") =>
    authClient.signIn.social({ provider, callbackURL: "/dashboard" });

  if (mode === "forgot") {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="Enter the email on your account and we'll send a reset link."
      >
        <form onSubmit={onForgotSubmit} noValidate className="mt-6 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="forgot-email" className="text-[0.6875rem] font-medium">
              Email
            </Label>
            <Input
              id="forgot-email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              {...forgotForm.register("email")}
            />
            {forgotForm.formState.errors.email && (
              <p className="text-[0.6875rem] text-destructive">
                {forgotForm.formState.errors.email.message}
              </p>
            )}
          </div>
          {error && <AuthError message={error} />}
          {info && <AuthInfo message={info} />}
          <Button
            type="submit"
            size="lg"
            className="mt-1 w-full"
            disabled={forgotForm.formState.isSubmitting}
          >
            {forgotForm.formState.isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
        <div className="mt-8 text-center text-[0.6875rem] text-muted-foreground">
          Remembered it?{" "}
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
              setInfo(null);
            }}
            className="rounded-[3px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  if (mode === "reset") {
    return (
      <AuthShell title="Choose a new password" subtitle="Enter a new password for your account.">
        <form onSubmit={onResetSubmit} noValidate className="mt-6 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-password" className="text-[0.6875rem] font-medium">
              New password
            </Label>
            <Input
              id="new-password"
              type="password"
              placeholder="8 characters or more"
              autoComplete="new-password"
              {...resetForm.register("password")}
            />
            {resetForm.formState.errors.password && (
              <p className="text-[0.6875rem] text-destructive">
                {resetForm.formState.errors.password.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="confirm-password" className="text-[0.6875rem] font-medium">
              Confirm password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Repeat your password"
              autoComplete="new-password"
              {...resetForm.register("confirmPassword")}
            />
            {resetForm.formState.errors.confirmPassword && (
              <p className="text-[0.6875rem] text-destructive">
                {resetForm.formState.errors.confirmPassword.message}
              </p>
            )}
          </div>
          {error && <AuthError message={error} />}
          {info && <AuthInfo message={info} />}
          <Button
            type="submit"
            size="lg"
            className="mt-1 w-full"
            disabled={resetForm.formState.isSubmitting || !token}
          >
            {resetForm.formState.isSubmitting ? "Updating…" : "Update password"}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={mode === "signin" ? "Sign in" : "Create your account"}
      subtitle={
        mode === "signin"
          ? "Access your workspace, sequences, and inbox."
          : "You'll create your first workspace next."
      }
    >
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
                className="rounded-[3px] text-[0.6875rem] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setInfo(null);
                }}
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
        {error && <AuthError message={error} />}
        {info && <AuthInfo message={info} />}
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
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
          className="rounded-[3px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {mode === "signin" ? "Sign up" : "Sign in"}
        </button>
      </div>
    </AuthShell>
  );
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
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

        <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">{title}</h1>
        <p className="mt-1.5 text-[0.75rem] text-muted-foreground">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function AuthError({ message }: { message: string }) {
  return (
    <div className="rounded-[4px] border border-[color:var(--status-red-600)]/30 bg-[color:var(--status-red-050)] px-2.5 py-1.5 text-[0.6875rem] text-[color:var(--status-red-600)]">
      {message}
    </div>
  );
}

function AuthInfo({ message }: { message: string }) {
  return (
    <div className="rounded-[4px] border border-border bg-[color:var(--paper-050)] px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground">
      {message}
    </div>
  );
}
