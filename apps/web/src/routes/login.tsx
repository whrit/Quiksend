import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { acceptInvitation } from "@/lib/invitations.functions.ts";

const loginSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
  invitationId: z.string().optional(),
  invitedEmail: z.string().optional(),
  organizationName: z.string().optional(),
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
  const {
    token,
    error: resetError,
    invitationId,
    invitedEmail,
    organizationName,
  } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">(
    token ? "reset" : invitationId ? "signup" : "signin",
  );
  const [error, setError] = useState<string | null>(resetError ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const acceptAttempted = useRef(false);
  const { data: session } = authClient.useSession();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: invitedEmail ?? "" },
  });
  const forgotForm = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema) });
  const resetForm = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  // Clicking the emailed verification link auto-signs the user in and
  // redirects back here with the invitation context intact — finish joining
  // instead of showing the sign-in/sign-up form again. One-shot via the ref
  // guard: a failed accept must never auto-retry (that would loop, since
  // `session`/`invitationId` stay truthy) — it sets `error`, which flips the
  // render below to the normal form with the error shown, and any further
  // attempt is a real user action (submitting the form), not automatic.
  useEffect(() => {
    if (!invitationId || !session || acceptAttempted.current) return;
    acceptAttempted.current = true;
    acceptInvitation({ data: { invitationId } })
      .then(() => navigate({ to: "/dashboard" }))
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : "The invitation could not be accepted — it may have expired or already been used.",
        );
      });
  }, [invitationId, session, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setInfo(null);
    // Threaded back through email verification so the invited user lands
    // right back here (with the invitation still in the URL) once verified.
    const callbackURL = invitationId ? window.location.href : undefined;

    if (mode === "signin") {
      const res = await authClient.signIn.email({
        email: values.email,
        password: values.password,
        callbackURL,
      });
      if (res.error) {
        const message = res.error.message ?? "";
        setError(
          /not verified/i.test(message)
            ? "Check your email to verify your account — we've sent a new verification link."
            : message || "Something went wrong. Please try again.",
        );
        return;
      }
      if (invitationId) {
        try {
          await acceptInvitation({ data: { invitationId } });
        } catch (err) {
          // Truthful failure: the account is signed in now, but never claim
          // the workspace invite succeeded when the server rejected it.
          setError(
            err instanceof Error
              ? err.message
              : "Signed in, but the invitation could not be accepted — ask an admin to resend it.",
          );
          return;
        }
      }
      await navigate({ to: "/dashboard" });
      return;
    }

    const res = await authClient.signUp.email({
      email: values.email,
      password: values.password,
      name: values.name?.trim() || values.email,
      callbackURL,
    });
    if (res.error) {
      setError(res.error.message ?? "Something went wrong. Please try again.");
      return;
    }
    // Email verification is required, so signup never signs the user in —
    // the account now exists, but nothing is joined yet. Truthful, not a
    // premature "you're in" — the `useEffect` above finishes the join once
    // the emailed link is clicked and auto-signs them in.
    setInfo(
      invitationId
        ? `Check your email to verify your account. Once verified, you'll automatically join ${organizationName ?? "the workspace"}.`
        : "Check your email to verify your account, then sign in.",
    );
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
      setError(res.error.message ?? "Couldn't queue a reset email. Please try again.");
      return;
    }
    setInfo("If an account exists for that email, a reset link has been queued for delivery.");
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
    authClient.signIn.social({
      provider,
      // Same-origin only: `window.location.href` is always the current
      // page's own URL (never attacker-controlled), so this can't become an
      // open redirect. Threads the invitation through OAuth exactly like the
      // email sign-in/sign-up flows above — landing back on this same
      // `/login?invitationId=...` URL with a session now active is what
      // trips the auto-accept `useEffect`.
      callbackURL: invitationId ? window.location.href : "/dashboard",
    });

  if (invitationId && session && !error) {
    return (
      <AuthShell
        title="Joining workspace…"
        subtitle={`Finishing up — you'll land in ${organizationName ?? "your workspace"} shortly.`}
      >
        <output className="mt-6 flex justify-center" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Joining workspace…</span>
        </output>
      </AuthShell>
    );
  }

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
              required
              aria-required="true"
              aria-invalid={Boolean(forgotForm.formState.errors.email)}
              aria-describedby={
                forgotForm.formState.errors.email ? "forgot-email-error" : undefined
              }
              {...forgotForm.register("email")}
            />
            {forgotForm.formState.errors.email && (
              <p id="forgot-email-error" role="alert" className="text-[0.6875rem] text-destructive">
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
            aria-busy={forgotForm.formState.isSubmitting}
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
              required
              aria-required="true"
              aria-invalid={Boolean(resetForm.formState.errors.password)}
              aria-describedby={
                resetForm.formState.errors.password ? "new-password-error" : undefined
              }
              {...resetForm.register("password")}
            />
            {resetForm.formState.errors.password && (
              <p id="new-password-error" role="alert" className="text-[0.6875rem] text-destructive">
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
              required
              aria-required="true"
              aria-invalid={Boolean(resetForm.formState.errors.confirmPassword)}
              aria-describedby={
                resetForm.formState.errors.confirmPassword ? "confirm-password-error" : undefined
              }
              {...resetForm.register("confirmPassword")}
            />
            {resetForm.formState.errors.confirmPassword && (
              <p
                id="confirm-password-error"
                role="alert"
                className="text-[0.6875rem] text-destructive"
              >
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
            aria-busy={resetForm.formState.isSubmitting}
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
        invitationId
          ? `You've been invited to join ${organizationName ?? "a workspace"} on Quiksend.`
          : mode === "signin"
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
            readOnly={Boolean(invitedEmail)}
            required
            aria-required="true"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" role="alert" className="text-[0.6875rem] text-destructive">
              {errors.email.message}
            </p>
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
            required
            aria-required="true"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password && (
            <p id="password-error" role="alert" className="text-[0.6875rem] text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>
        {error && <AuthError message={error} />}
        {info && <AuthInfo message={info} />}
        <Button
          type="submit"
          size="lg"
          className="mt-1 w-full"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
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
        <div className="h-px flex-1 bg-border" aria-hidden="true" />
        <span className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.02em] text-muted-foreground">
          or
        </span>
        <div className="h-px flex-1 bg-border" aria-hidden="true" />
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the heading whenever the screen changes (sign in <-> sign
  // up <-> forgot <-> reset <-> joining-workspace) — each is a distinct
  // "view" swapped in place, so nothing else naturally tells a screen reader
  // user the content just changed.
  useEffect(() => {
    headingRef.current?.focus();
  }, [title]);

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

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.375rem] font-semibold leading-tight tracking-[-0.015em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-[3px]"
        >
          {title}
        </h1>
        <p className="mt-1.5 text-[0.75rem] text-muted-foreground">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function AuthError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[4px] border border-[color:var(--status-red-600)]/30 bg-[color:var(--status-red-050)] px-2.5 py-1.5 text-[0.6875rem] text-[color:var(--status-red-600)]"
    >
      {message}
    </div>
  );
}

function AuthInfo({ message }: { message: string }) {
  return (
    <output
      aria-live="polite"
      aria-atomic="true"
      className="rounded-[4px] border border-border bg-[color:var(--paper-050)] px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground"
    >
      {message}
    </output>
  );
}
