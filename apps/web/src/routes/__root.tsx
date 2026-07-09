import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { initSentry } from "@/lib/sentry-init.ts";
import appCss from "@/styles/app.css?url";

// Init Sentry before the router is constructed so any error thrown during SSR —
// route loaders, server-fn 500s, API-route throws — is captured. On the client
// bundle `initSentry` compiles down to a no-op (see `sentry-init.ts`).
initSentry();

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Quiksend" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootErrorBoundary,
});

function RootErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <RootDocument>
      <div className="grain relative min-h-screen bg-background text-foreground">
        <div className="relative z-[2] mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="micro-label">Error · Unhandled exception</div>
          <h1 className="font-display text-[3rem] leading-none tracking-[-0.02em]">
            Something{" "}
            <span className="font-display-italic text-[color:var(--amber-600)]">snapped</span>.
          </h1>
          <p className="mt-1 max-w-md text-[0.875rem] text-muted-foreground">{message}</p>
          <div className="mt-2 flex gap-2">
            <a
              href="/dashboard"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[0.8125rem] font-medium transition-colors hover:bg-secondary"
            >
              Return to dashboard
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-8 items-center rounded-md bg-foreground px-3 text-[0.8125rem] font-medium text-background hover:bg-foreground/92"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    </RootDocument>
  );
}

function NotFound() {
  return (
    <RootDocument>
      <div className="grain relative min-h-screen bg-background text-foreground">
        <div className="relative z-[2] mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="micro-label">404 · Missing page</div>
          <h1 className="font-display text-[5rem] leading-none tracking-[-0.03em] tabular">
            <span className="text-foreground">Not </span>
            <span className="font-display-italic text-[color:var(--amber-600)]">found</span>.
          </h1>
          <p className="mt-1 max-w-sm text-[0.875rem] text-muted-foreground">
            That page doesn't exist. Check the URL or head back to your dashboard.
          </p>
          <a
            href="/dashboard"
            className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[0.8125rem] font-medium transition-colors hover:bg-secondary"
          >
            Go to dashboard →
          </a>
        </div>
      </div>
    </RootDocument>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // `suppressHydrationWarning` — browser extensions (Grammarly, 1Password,
    // LastPass, dark-mode injectors) commonly patch attributes onto `<html>`
    // and `<body>` BEFORE React hydrates. React can't reconcile those and
    // logs a noisy hydration mismatch. This flag tells React the mismatch is
    // expected and not our fault — scoped to just these two elements so real
    // hydration bugs in app content still surface loudly.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Toaster richColors position="top-right" />
        <Scripts />
      </body>
    </html>
  );
}
