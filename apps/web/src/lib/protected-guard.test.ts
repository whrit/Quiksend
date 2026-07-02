import { describe, expect, it } from "vitest";
import { evaluateProtectedAccess } from "./protected-guard.ts";

describe("evaluateProtectedAccess", () => {
  it("redirects unauthenticated users", async () => {
    await expect(evaluateProtectedAccess(null)).resolves.toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("redirects authenticated users without an active workspace", async () => {
    await expect(
      evaluateProtectedAccess({
        user: { id: "u1", email: "a@example.com", name: "A" },
        session: { activeOrganizationId: null },
      } as never),
    ).resolves.toEqual({ ok: false, reason: "no_workspace" });
  });
});
