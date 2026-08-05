/**
 * Tests the pure helpers in invitations.server.ts (not the createServerFn
 * wrappers). Auth.api integration tests live in auth.test.ts.
 */
import { describe, expect, it } from "vitest";
import { asOrganizationId, asUserId, type OrgContext } from "@quiksend/core";
import {
  requireAdminOrOwner,
  selectPendingInvitations,
  toInvitationSummary,
} from "./invitations.server.ts";

function orgContext(role: OrgContext["role"]): OrgContext {
  return { userId: asUserId("user_1"), organizationId: asOrganizationId("org_1"), role };
}

describe("requireAdminOrOwner", () => {
  it("allows an owner", () => {
    expect(() => requireAdminOrOwner(orgContext("owner"))).not.toThrow();
  });

  it("allows an admin", () => {
    expect(() => requireAdminOrOwner(orgContext("admin"))).not.toThrow();
  });

  it("rejects a plain member — invitation management is admin/owner only", () => {
    expect(() => requireAdminOrOwner(orgContext("member"))).toThrow(/admin or owner/i);
  });
});

describe("toInvitationSummary", () => {
  it("narrows a Better Auth invitation row to only the UI-safe fields", () => {
    const expiresAt = new Date("2026-01-01T00:00:00Z");
    const summary = toInvitationSummary({
      id: "inv_1",
      email: "teammate@example.com",
      role: "member",
      status: "pending",
      expiresAt,
      // Extra fields a real Better Auth row carries (organizationId,
      // inviterId, createdAt, ...) must not leak into the summary.
      organizationId: "org_1",
      inviterId: "user_1",
    } as never);
    expect(summary).toEqual({
      id: "inv_1",
      email: "teammate@example.com",
      role: "member",
      status: "pending",
      expiresAt,
    });
  });
});

describe("selectPendingInvitations", () => {
  it("keeps only pending invitations — canceled/accepted/rejected are history, not actionable", () => {
    const invitations = [
      { id: "1", status: "pending" },
      { id: "2", status: "accepted" },
      { id: "3", status: "canceled" },
      { id: "4", status: "rejected" },
      { id: "5", status: "pending" },
    ];
    expect(selectPendingInvitations(invitations).map((i) => i.id)).toEqual(["1", "5"]);
  });

  it("returns an empty array when nothing is pending", () => {
    expect(selectPendingInvitations([{ id: "1", status: "accepted" }])).toEqual([]);
  });
});
