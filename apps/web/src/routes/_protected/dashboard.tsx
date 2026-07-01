import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Route as ProtectedRoute } from "@/routes/_protected";

export const Route = createFileRoute("/_protected/dashboard")({ component: Dashboard });

function Dashboard() {
  const { user } = ProtectedRoute.useRouteContext();
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {user.name || user.email}</CardTitle>
          <CardDescription>
            You are signed in. Sequences, prospects, and the inbox land in later phases.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use the workspace switcher above to create or change workspaces.
        </CardContent>
      </Card>
    </div>
  );
}
