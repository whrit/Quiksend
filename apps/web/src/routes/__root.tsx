import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import appCss from "@/styles/app.css?url";

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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-lg text-sm text-muted-foreground">{message}</p>
        <div className="flex gap-3 text-sm">
          <a href="/dashboard" className="underline">
            Go to dashboard
          </a>
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </RootDocument>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        That page doesn't exist. Check the URL or head back to your dashboard.
      </p>
      <a href="/dashboard" className="text-sm underline">
        Go to dashboard
      </a>
    </div>
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
