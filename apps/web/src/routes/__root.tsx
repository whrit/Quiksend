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
      <div className="min-h-[100dvh] bg-background text-foreground">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="micro-label">Unhandled error</div>
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.015em]">
            Something went wrong
          </h1>
          <p className="max-w-md text-[0.75rem] text-muted-foreground">{message}</p>
          <div className="mt-2 flex gap-2">
            <a
              href="/dashboard"
              className="inline-flex h-7 items-center rounded-[4px] border border-border bg-card px-2.5 text-[0.75rem] font-medium transition-colors hover:bg-[color:var(--paper-050)]"
            >
              Return to dashboard
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-7 items-center rounded-[4px] bg-foreground px-2.5 text-[0.75rem] font-medium text-background hover:bg-[color:var(--paper-800)]"
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
      <div className="min-h-[100dvh] bg-background text-foreground">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="micro-label">404 · Not found</div>
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.015em]">
            Page not found
          </h1>
          <p className="max-w-sm text-[0.75rem] text-muted-foreground">
            The page you're looking for doesn't exist. Check the URL or head back to your dashboard.
          </p>
          <a
            href="/dashboard"
            className="mt-2 inline-flex h-7 items-center rounded-[4px] border border-border bg-card px-2.5 text-[0.75rem] font-medium transition-colors hover:bg-[color:var(--paper-050)]"
          >
            Go to dashboard
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
