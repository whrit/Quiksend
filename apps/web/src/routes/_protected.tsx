import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { authClient } from "@/lib/auth-client";
import { getSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/login" });
    }
    return { user: session.user };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Quiksend</span>
          <WorkspaceSwitcher />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void authClient.signOut().then(() => window.location.assign("/login"))}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
