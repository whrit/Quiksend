/**
 * Auth config tests against the real test DB. `SYSTEM_ADMIN_EMAIL` is mocked
 * per-case; `@quiksend/queue`'s `enqueueWithRetries` is mocked so transactional
 * mail (reset/invitation/verification) never touches a real queue or SMTP relay
 * — `auth.ts` durably enqueues rather than sending inline (see `mail.send_transactional`).
 */
import { randomUUID } from "node:crypto";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { applySetCookies } from "better-auth/cookies";
import { and, eq, gt } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { SYSTEM_ADMIN_EMAIL: undefined as string | undefined },
}));

vi.mock("@quiksend/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/config")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get SYSTEM_ADMIN_EMAIL() {
        return mockEnv.SYSTEM_ADMIN_EMAIL;
      },
    },
  };
});

interface TransactionalMailJobPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const enqueueWithRetriesMock = vi.hoisted(() =>
  vi.fn<(job: string, payload: TransactionalMailJobPayload) => Promise<string | null>>(),
);

vi.mock("@quiksend/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/queue")>();
  return { ...actual, enqueueWithRetries: enqueueWithRetriesMock };
});

import { auth, enqueueTransactionalEmail, resolveDefaultActiveOrganizationId } from "./auth.ts";

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function createUser(): Promise<string> {
  const id = makeId("user");
  await db.insert(tables.user).values({
    id,
    email: `${id}@test.local`,
    emailVerified: true,
    name: id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function createOrgWithMember(userId: string, order = 0, name?: string): Promise<string> {
  const orgId = makeId("org");
  await db.insert(tables.organization).values({
    id: orgId,
    name: name ?? `Org ${orgId}`,
    slug: orgId,
    createdAt: new Date(Date.now() + order * 1000),
  });
  await db.insert(tables.member).values({
    id: makeId("mem"),
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: new Date(Date.now() + order * 1000),
  });
  return orgId;
}

async function createSession(userId: string, activeOrganizationId: string | null): Promise<void> {
  await db.insert(tables.session).values({
    id: makeId("sess"),
    token: makeId("tok"),
    userId,
    activeOrganizationId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function createInvitation(params: {
  organizationId: string;
  email: string;
  inviterId: string;
  expiresAt?: Date;
}): Promise<string> {
  const id = makeId("inv");
  await db.insert(tables.invitation).values({
    id,
    organizationId: params.organizationId,
    email: params.email.toLowerCase(),
    role: "member",
    status: "pending",
    expiresAt: params.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    inviterId: params.inviterId,
  });
  return id;
}

async function headersFromSetCookie(setCookie: string | null): Promise<Headers> {
  const headers = new Headers();
  if (setCookie) applySetCookies(headers, [setCookie]);
  return headers;
}

/**
 * Signs a fresh Better Auth user up, then bypasses the real verification-link
 * round trip (no `auth.api` surface exposes the internal JWT signer used to
 * mint one) by flipping `emailVerified` directly and signing in for real.
 * `requireEmailVerification: true` means `signUpEmail` itself never creates a
 * session, so every test that needs an authenticated caller goes through this.
 */
async function signUpAndAuthenticate(
  email: string,
  password = "correct horse battery staple",
): Promise<{ userId: string; headers: Headers }> {
  const signedUp = await auth.api.signUpEmail({ body: { email, password, name: email } });
  await db.update(tables.user).set({ emailVerified: true }).where(eq(tables.user.id, signedUp.user.id));
  const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const headers = await headersFromSetCookie(signedIn.headers.get("set-cookie"));
  return { userId: signedUp.user.id, headers };
}

const createdUserIds: string[] = [];

async function trackUser(): Promise<string> {
  const id = await createUser();
  createdUserIds.push(id);
  return id;
}

afterEach(async () => {
  // Clean up in dependency order — verification, session, member, org, user.
  // `invitation` and `account` cascade-delete via their `user`/`organization`
  // FKs so they don't need their own pass here.
  for (const userId of createdUserIds) {
    await db.delete(tables.verification).where(eq(tables.verification.value, userId));
    await db.delete(tables.session).where(eq(tables.session.userId, userId));
    const memberRows = await db.query.member.findMany({
      where: eq(tables.member.userId, userId),
      columns: { organizationId: true },
    });
    await db.delete(tables.member).where(eq(tables.member.userId, userId));
    for (const m of memberRows) {
      await db.delete(tables.organization).where(eq(tables.organization.id, m.organizationId));
    }
    await db.delete(tables.user).where(eq(tables.user.id, userId));
  }
  createdUserIds.length = 0;
  mockEnv.SYSTEM_ADMIN_EMAIL = undefined;
  enqueueWithRetriesMock.mockReset();
  enqueueWithRetriesMock.mockResolvedValue("job_1");
});

describe("resolveDefaultActiveOrganizationId", () => {
  it("returns null for a user with no memberships (onboarding path)", async () => {
    const userId = await trackUser();
    expect(await resolveDefaultActiveOrganizationId(userId)).toBeNull();
  });

  it("returns the user's only workspace on a fresh login", async () => {
    const userId = await trackUser();
    const orgId = await createOrgWithMember(userId);
    expect(await resolveDefaultActiveOrganizationId(userId)).toBe(orgId);
  });

  it("reuses the prior session's active org when the user still belongs to it", async () => {
    const userId = await trackUser();
    const orgA = await createOrgWithMember(userId, 0);
    // Second membership exists but the prior-session preference must win, so
    // its id is captured for clarity but not asserted on here.
    await createOrgWithMember(userId, 1);
    // Prior session had orgA active — that should win, even though orgB is the
    // most-recently-joined membership (fallback path).
    await createSession(userId, orgA);
    expect(await resolveDefaultActiveOrganizationId(userId)).toBe(orgA);
  });

  it("ignores a prior session's active org if the user was removed from that workspace", async () => {
    const userId = await trackUser();
    const orgA = await createOrgWithMember(userId, 0);
    const orgB = await createOrgWithMember(userId, 1);
    await createSession(userId, orgA);
    // Simulate the user being kicked out of orgA
    await db
      .delete(tables.member)
      .where(and(eq(tables.member.userId, userId), eq(tables.member.organizationId, orgA)));
    expect(await resolveDefaultActiveOrganizationId(userId)).toBe(orgB);
  });
});

describe("email verification", () => {
  it("enqueues a verification email on signup", async () => {
    const email = `${makeId("verify")}@test.local`;
    const result = await auth.api.signUpEmail({
      body: { email, password: "whatever password", name: email },
    });
    createdUserIds.push(result.user.id);

    expect(result.token).toBeNull();
    expect(enqueueWithRetriesMock).toHaveBeenCalledExactlyOnceWith(
      "mail.send_transactional",
      expect.objectContaining({
        to: email,
        text: expect.stringContaining("/verify-email"),
        html: expect.stringContaining("/verify-email"),
      }),
    );
  });

  it("denies sign-in for an unverified account", async () => {
    const email = `${makeId("unverified")}@test.local`;
    const password = "whatever password";
    const result = await auth.api.signUpEmail({ body: { email, password, name: email } });
    createdUserIds.push(result.user.id);

    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toThrow();
  });

  it("allows sign-in once the account is verified", async () => {
    const { userId, headers } = await signUpAndAuthenticate(`${makeId("verified")}@test.local`);
    createdUserIds.push(userId);
    expect(await auth.api.getSession({ headers })).not.toBeNull();
  });
});

describe("password reset", () => {
  it("delivers the reset link via the transactional mail queue for an existing user", async () => {
    const email = `${makeId("reset")}@test.local`;
    const { userId } = await signUpAndAuthenticate(email);
    createdUserIds.push(userId);
    enqueueWithRetriesMock.mockClear();

    const res = await auth.api.requestPasswordReset({ body: { email } });

    expect(res.status).toBe(true);
    expect(enqueueWithRetriesMock).toHaveBeenCalledExactlyOnceWith(
      "mail.send_transactional",
      expect.objectContaining({
        to: email,
        text: expect.stringContaining("/reset-password/"),
        html: expect.stringContaining("/reset-password/"),
      }),
    );
  });

  it("returns the identical response for an existing and a nonexistent email, and never emails the nonexistent one", async () => {
    const email = `${makeId("reset")}@test.local`;
    const { userId } = await signUpAndAuthenticate(email);
    createdUserIds.push(userId);
    enqueueWithRetriesMock.mockClear();

    const existing = await auth.api.requestPasswordReset({ body: { email } });
    expect(enqueueWithRetriesMock).toHaveBeenCalledTimes(1);

    const missing = await auth.api.requestPasswordReset({
      body: { email: `${makeId("ghost")}@test.local` },
    });

    // Timing-safe / non-enumerating: identical shape and message either way,
    // and no second email was enqueued for the email that doesn't exist.
    expect(missing).toEqual(existing);
    expect(enqueueWithRetriesMock).toHaveBeenCalledTimes(1);
  });

  it("revokes every existing session once the password is actually reset", async () => {
    const email = `${makeId("reset")}@test.local`;
    const { userId, headers } = await signUpAndAuthenticate(email);
    createdUserIds.push(userId);
    // sign-in already created one session; add a second to prove *all*
    // sessions are revoked, not just the one active during the flow.
    await createSession(userId, null);
    const beforeSessions = await db.query.session.findMany({ where: eq(tables.session.userId, userId) });
    expect(beforeSessions.length).toBeGreaterThanOrEqual(2);

    await auth.api.requestPasswordReset({ body: { email } });
    const verification = await db.query.verification.findFirst({
      where: and(eq(tables.verification.value, userId), gt(tables.verification.expiresAt, new Date())),
    });
    expect(verification).toBeDefined();
    const token = verification!.identifier.replace("reset-password:", "");

    const result = await auth.api.resetPassword({ body: { newPassword: "another strong password", token } });
    expect(result.status).toBe(true);

    const afterSessions = await db.query.session.findMany({ where: eq(tables.session.userId, userId) });
    expect(afterSessions).toHaveLength(0);
    // The reset itself doesn't leave the caller signed in on this headers set.
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("routes the reset email through the transactional queue helper", async () => {
    // Covered precisely (not through a swallowed HTTP round trip — see the
    // `enqueueTransactionalEmail` describe block below for why) by asserting
    // the enqueue call happened; failure-propagation itself is unit-tested
    // directly against `enqueueTransactionalEmail`.
    const email = `${makeId("reset")}@test.local`;
    const { userId } = await signUpAndAuthenticate(email);
    createdUserIds.push(userId);
    enqueueWithRetriesMock.mockClear();

    await auth.api.requestPasswordReset({ body: { email } });
    expect(enqueueWithRetriesMock).toHaveBeenCalledOnce();
  });
});

describe("enqueueTransactionalEmail", () => {
  const payload = { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" };

  afterEach(() => {
    enqueueWithRetriesMock.mockReset();
  });

  it("rethrows instead of swallowing a rejected enqueue — never treats a failure as sent", async () => {
    enqueueWithRetriesMock.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(enqueueTransactionalEmail(payload)).rejects.toThrow("queue unavailable");
  });

  it("throws when the queue accepts the call but returns no job id (pg-boss debounce/failure)", async () => {
    enqueueWithRetriesMock.mockResolvedValueOnce(null);
    await expect(enqueueTransactionalEmail(payload)).rejects.toThrow(
      "Failed to enqueue transactional email",
    );
  });

  it("resolves cleanly on a real job id", async () => {
    enqueueWithRetriesMock.mockResolvedValueOnce("job_42");
    await expect(enqueueTransactionalEmail(payload)).resolves.toBeUndefined();
    expect(enqueueWithRetriesMock).toHaveBeenCalledExactlyOnceWith("mail.send_transactional", payload);
  });
});

describe("invitation-only signup", () => {
  it("rejects an email with no invitation and no bootstrap match", async () => {
    mockEnv.SYSTEM_ADMIN_EMAIL = "admin@quiksend.test";
    const email = `${makeId("uninvited")}@test.local`;

    await expect(
      auth.api.signUpEmail({ body: { email, password: "whatever password", name: email } }),
    ).rejects.toThrow();
    const user = await db.query.user.findFirst({ where: eq(tables.user.email, email.toLowerCase()) });
    expect(user).toBeUndefined();
  });

  it("allows signup for an email with a pending, unexpired invitation", async () => {
    mockEnv.SYSTEM_ADMIN_EMAIL = "admin@quiksend.test";
    const inviterId = await trackUser();
    const orgId = await createOrgWithMember(inviterId);
    const invitedEmail = `${makeId("invited")}@test.local`;
    await createInvitation({ organizationId: orgId, email: invitedEmail, inviterId });

    const result = await auth.api.signUpEmail({
      body: { email: invitedEmail, password: "whatever password", name: invitedEmail },
    });
    createdUserIds.push(result.user.id);
    expect(result.user.email).toBe(invitedEmail.toLowerCase());
  });

  it("rejects signup for an email whose invitation already expired", async () => {
    mockEnv.SYSTEM_ADMIN_EMAIL = "admin@quiksend.test";
    const inviterId = await trackUser();
    const orgId = await createOrgWithMember(inviterId);
    const invitedEmail = `${makeId("expired")}@test.local`;
    await createInvitation({
      organizationId: orgId,
      email: invitedEmail,
      inviterId,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      auth.api.signUpEmail({ body: { email: invitedEmail, password: "whatever password", name: invitedEmail } }),
    ).rejects.toThrow();
  });

  it("allows signup for the configured system-admin bootstrap email", async () => {
    const adminEmail = `${makeId("bootstrap")}@test.local`;
    mockEnv.SYSTEM_ADMIN_EMAIL = adminEmail;

    const result = await auth.api.signUpEmail({
      body: { email: adminEmail, password: "whatever password", name: "Admin" },
    });
    createdUserIds.push(result.user.id);
    expect(result.user.email).toBe(adminEmail.toLowerCase());
  });

  it("leaves signup open when no system-admin bootstrap identity is configured (self-host)", async () => {
    mockEnv.SYSTEM_ADMIN_EMAIL = undefined;
    const email = `${makeId("selfhost")}@test.local`;

    const result = await auth.api.signUpEmail({
      body: { email, password: "whatever password", name: email },
    });
    createdUserIds.push(result.user.id);
    expect(result.user.email).toBe(email.toLowerCase());
  });
});

describe("organization creation", () => {
  it("rejects organization creation for a signed-in user who isn't the bootstrap admin", async () => {
    mockEnv.SYSTEM_ADMIN_EMAIL = "admin@quiksend.test";
    // Bootstrap admin owns a seed org and invites this member in — signing
    // them up via the invitation path (not the bootstrap-email path) proves
    // the organization-creation gate is independent of the signup gate.
    const inviterId = await trackUser();
    const seedOrgId = await createOrgWithMember(inviterId);
    const email = `${makeId("member")}@test.local`;
    await createInvitation({ organizationId: seedOrgId, email, inviterId });
    const { userId, headers } = await signUpAndAuthenticate(email);
    createdUserIds.push(userId);

    await expect(
      auth.api.createOrganization({ headers, body: { name: "Rogue Org", slug: makeId("rogue") } }),
    ).rejects.toThrow();
  });

  it("allows organization creation for the bootstrap admin", async () => {
    const adminEmail = `${makeId("bootstrap")}@test.local`;
    mockEnv.SYSTEM_ADMIN_EMAIL = adminEmail;
    const { userId, headers } = await signUpAndAuthenticate(adminEmail);
    createdUserIds.push(userId);

    const org = await auth.api.createOrganization({
      headers,
      body: { name: "Quiksend Systems", slug: makeId("qs") },
    });
    expect(org?.id).toBeDefined();
  });
});

describe("member invitations", () => {
  it("sends an invitation email with an acceptance link carrying the invitation id and org name", async () => {
    const ownerEmail = `${makeId("owner")}@test.local`;
    const { userId: ownerId, headers } = await signUpAndAuthenticate(ownerEmail);
    createdUserIds.push(ownerId);
    const orgId = await createOrgWithMember(ownerId);
    const invitedEmail = `${makeId("invitee")}@test.local`;
    enqueueWithRetriesMock.mockClear();

    const invitation = await auth.api.createInvitation({
      headers,
      body: { email: invitedEmail, role: "member", organizationId: orgId },
    });

    expect(invitation.id).toBeDefined();
    expect(enqueueWithRetriesMock).toHaveBeenCalledExactlyOnceWith(
      "mail.send_transactional",
      expect.objectContaining({
        to: invitedEmail.toLowerCase(),
        text: expect.stringContaining(`invitationId=${invitation.id}`),
        html: expect.stringContaining(`invitationId=${invitation.id}`),
      }),
    );
    const [, call] = enqueueWithRetriesMock.mock.calls[0]!;
    expect(call.text).toContain(`Org ${orgId}`);
  });

  it("escapes a hostile organization name before it reaches the HTML email body", async () => {
    const ownerEmail = `${makeId("owner")}@test.local`;
    const { userId: ownerId, headers } = await signUpAndAuthenticate(ownerEmail);
    createdUserIds.push(ownerId);
    const hostileName = `Acme"><img src=x onerror=alert(1)>`;
    const orgId = await createOrgWithMember(ownerId, 0, hostileName);
    const invitedEmail = `${makeId("invitee")}@test.local`;
    enqueueWithRetriesMock.mockClear();

    await auth.api.createInvitation({
      headers,
      body: { email: invitedEmail, role: "member", organizationId: orgId },
    });

    const [, call] = enqueueWithRetriesMock.mock.calls[0]!;
    const html = call.html;
    expect(html).not.toContain("<img");
    expect(html).not.toContain(hostileName);
    expect(html).toContain("Acme&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("lets an org admin cancel a pending invitation", async () => {
    const ownerEmail = `${makeId("owner")}@test.local`;
    const { userId: ownerId, headers } = await signUpAndAuthenticate(ownerEmail);
    createdUserIds.push(ownerId);
    const orgId = await createOrgWithMember(ownerId);
    const invitedEmail = `${makeId("invitee")}@test.local`;

    const invitation = await auth.api.createInvitation({
      headers,
      body: { email: invitedEmail, role: "member", organizationId: orgId },
    });
    const canceled = await auth.api.cancelInvitation({
      headers,
      body: { invitationId: invitation.id },
    });

    expect(canceled?.status).toBe("canceled");
  });
});
