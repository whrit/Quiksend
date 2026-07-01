import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function WorkspaceSwitcher() {
  const { data: organizations } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = async () => {
    if (!name.trim()) return;
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    await authClient.organization.create({ name: name.trim(), slug });
    setName("");
    setCreating(false);
  };

  const switchTo = (organizationId: string) =>
    authClient.organization.setActive({ organizationId });

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={active?.id ?? ""}
        onChange={(e) => void switchTo(e.target.value)}
      >
        {(organizations ?? []).map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
        {(organizations ?? []).length === 0 && <option value="">No workspace yet</option>}
      </select>
      {creating ? (
        <div className="flex items-center gap-1">
          <Input
            className="h-9 w-40"
            placeholder="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button size="sm" onClick={() => void create()}>
            Create
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          New workspace
        </Button>
      )}
    </div>
  );
}
