import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { env, logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { escapeHtml } from "@quiksend/mail";
import { enqueueWithRetries } from "@quiksend/queue";
import { APIError, betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, desc, eq, gt } from "drizzle-orm";

/**
 * Look up the workspace the user should land in on a fresh session. Prefers a
 * membership the user already had active on their last session (so switching
 * workspaces sticks across logouts), then falls back to their most-recently
 * created membership.
 *
 * Returns `null` when the user has no memberships yet — that's the onboarding
 * path.
 */
export async function resolveDefaultActiveOrganizationId(userId: string): Promise<string | null> {
  // Reuse the most recent prior session's active org if the user had one and
  // still belongs to that workspace. Covers both the "logout + log back in"
  // case (Better Auth deletes sessions on sign-out) and the "server restart"
  // case (sessions survive restarts until expiry).
  const priorSession = await db.query.session.findFirst({
    where: eq(tables.session.userId, userId),
    orderBy: [desc(tables.session.createdAt)],
    columns: { activeOrganizationId: true },
  });
  if (priorSession?.activeOrganizationId) {
    const stillMember = await db.query.member.findFirst({
      where: and(
        eq(tables.member.userId, userId),
        eq(tables.member.organizationId, priorSession.activeOrganizationId),
      ),
      columns: { id: true },
    });
    if (stillMember) return priorSession.activeOrganizationId;
  }

  // Otherwise fall back to whichever workspace the user joined most recently.
  const firstMembership = await db.query.member.findFirst({
    where: eq(tables.member.userId, userId),
    orderBy: [desc(tables.member.createdAt)],
    columns: { organizationId: true },
  });
  return firstMembership?.organizationId ?? null;
}

/**
 * Case-insensitive match against the configured Quiksend Systems operator
 * bootstrap identity (`SYSTEM_ADMIN_EMAIL`). Unset in local development —
 * every bootstrap/invite gate below is a no-op in that case. `env.schema.ts`
 * requires it in production (self-host included), so this only stays a no-op
 * outside production.
 */
function isSystemAdminEmail(email: string): boolean {
  return (
    Boolean(env.SYSTEM_ADMIN_EMAIL) && email.toLowerCase() === env.SYSTEM_ADMIN_EMAIL?.toLowerCase()
  );
}

/** Whether `email` has a pending, unexpired organization invitation. */
async function hasUnexpiredPendingInvitation(email: string): Promise<boolean> {
  const invitation = await db.query.invitation.findFirst({
    where: and(
      eq(tables.invitation.email, email.toLowerCase()),
      eq(tables.invitation.status, "pending"),
      gt(tables.invitation.expiresAt, new Date()),
    ),
    columns: { id: true },
  });
  return Boolean(invitation);
}

function appBaseUrl(): string {
  return env.BETTER_AUTH_URL ?? "http://localhost:3000";
}

/**
 * Durably enqueues a transactional email instead of sending it inline —
 * `apps/worker`'s `mail.send_transactional` handler does the actual SMTP
 * send, so account-flow response latency never depends on relay round-trip
 * time. Never swallows a failure: a failed enqueue is logged *and* rethrown.
 *
 * Caveat callers should know: Better Auth wraps every `sendResetPassword` /
 * `sendInvitationEmail` / `sendVerificationEmail` hook in its own
 * `runInBackgroundOrAwait`, which — with no `advanced.backgroundTasks.handler`
 * configured (we don't; see below) — awaits the hook inline but catches and
 * only *logs* a thrown error rather than failing the HTTP response. That's
 * intentional for `requestPasswordReset` (a hard failure there would leak
 * account existence). Configuring a custom background handler would make
 * every hook truly fire-and-forget instead, which is strictly worse for
 * surfacing failures — so this stays as the honest boundary: our code never
 * treats a failed enqueue as success, but Better Auth's password-reset route
 * still returns its fixed, non-enumerating response either way.
 */
export async function enqueueTransactionalEmail(payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  let jobId: string | null;
  try {
    jobId = await enqueueWithRetries("mail.send_transactional", payload);
  } catch (err) {
    logger.error(
      { err, to: payload.to, subject: payload.subject },
      "Failed to enqueue transactional email",
    );
    throw err;
  }
  if (!jobId) {
    logger.error(
      { to: payload.to, subject: payload.subject },
      "Transactional email enqueue returned no job id",
    );
    throw new Error("Failed to enqueue transactional email");
  }
}

/**
 * Explicit organization access control for the `apiKey` resource. Better
 * Auth's built-in org statements (`organization`, `member`, `invitation`,
 * `team`, `ac`) say nothing about API keys, so without this the `apiKey`
 * plugin's own `references: "organization"` authorization (see
 * `checkOrgApiKeyPermission` in `@better-auth/api-key`) silently falls back
 * to "only the org creator role can touch API keys at all" — every other
 * admin action in this app treats admin and owner as equivalent
 * (`isAdminOrOwner`, `packages/core/src/tenancy.ts`), so API keys get the
 * same explicit grant here. This is enforced by Better Auth itself, so it
 * applies uniformly to app server functions AND to the raw
 * `/api/auth/api-key/*` endpoints — no vendor-default accident either way.
 */
const organizationStatement = {
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
} as const;
const organizationAc = createAccessControl(organizationStatement);
const organizationRoles = {
  owner: organizationAc.newRole({
    ...ownerAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  admin: organizationAc.newRole({
    ...adminAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  member: organizationAc.newRole({ ...memberAc.statements, apiKey: [] }),
};

/**
 * Better Auth server instance, shared by apps/web (handler + server fns) and, later,
 * the public API. Multi-tenancy comes from the `organization` plugin (org = workspace).
 *
 * The `databaseHooks.session.create.before` hook auto-populates
 * `activeOrganizationId` on every fresh session — without it, users lose their
 * workspace association on logout / service restart (fresh session rows
 * default to `NULL`, and the client-side `setActive()` call only writes to
 * the session cookie in flight at that moment).
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : [],
  emailAndPassword: {
    enabled: true,
    // Credential accounts must verify their email before they can sign in —
    // pairs with `emailVerification` below (invited users verify, then sign
    // in and accept, per the invitation link's preserved callback state).
    requireEmailVerification: true,
    // A leaked/expired reset link is a narrow window, and a successful reset
    // kills every other session for the account so a stolen password can't
    // ride an already-open session elsewhere.
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await enqueueTransactionalEmail({
        to: user.email,
        subject: "Reset your Quiksend password",
        text: `Reset your Quiksend password:\n${url}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email — your password hasn't changed.`,
        html:
          `<p>Reset your Quiksend password by clicking the link below. This link expires in 1 hour.</p>` +
          `<p><a href="${url}">Reset password</a></p>` +
          `<p>If you didn't request this, you can ignore this email — your password hasn't changed.</p>`,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await enqueueTransactionalEmail({
        to: user.email,
        subject: "Verify your Quiksend email",
        text: `Verify your email to finish setting up your Quiksend account:\n${url}\n\nThis link expires in 1 hour.`,
        html:
          `<p>Verify your email to finish setting up your Quiksend account.</p>` +
          `<p><a href="${url}">Verify email</a></p>` +
          `<p>This link expires in 1 hour.</p>`,
      });
    },
    sendOnSignUp: true,
    // Re-sends the verification link (preserving the caller's `callbackURL`,
    // e.g. back to an invitation) when an unverified user attempts sign-in.
    sendOnSignIn: true,
    // Clicking the verification link signs the user in immediately — no
    // separate manual sign-in step between "verify" and "accept invitation".
    autoSignInAfterVerification: true,
    expiresIn: 3600,
  },
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET
      ? { microsoft: { clientId: env.MS_CLIENT_ID, clientSecret: env.MS_CLIENT_SECRET } }
      : {}),
  },
  databaseHooks: {
    user: {
      create: {
        // Invitation-only account creation: a brand-new user record is only
        // allowed for the system-admin bootstrap identity or an email with a
        // live invitation. This fires for both credential sign-up and
        // first-time OAuth sign-in (Better Auth routes both through the same
        // internal-adapter `createUser`/`createOAuthUser` path) — linking a
        // new provider to an *already-existing* user never hits it.
        before: async (user) => {
          if (!env.SYSTEM_ADMIN_EMAIL) return { data: user };
          if (isSystemAdminEmail(user.email)) return { data: user };
          if (await hasUnexpiredPendingInvitation(user.email)) return { data: user };
          throw new APIError("FORBIDDEN", {
            message: "An invitation is required to create a Quiksend account.",
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          if (session.activeOrganizationId) return { data: session };
          const activeOrganizationId = await resolveDefaultActiveOrganizationId(session.userId);
          if (!activeOrganizationId) return { data: session };
          return { data: { ...session, activeOrganizationId } };
        },
      },
    },
  },
  plugins: [
    organization({
      // Bootstrap-only workspace creation: everyone else joins an existing
      // organization by accepting an invitation, which adds the membership
      // directly and never calls `/organization/create`.
      allowUserToCreateOrganization: (user) =>
        !env.SYSTEM_ADMIN_EMAIL || isSystemAdminEmail(user.email),
      // Explicit `apiKey` resource grants (owner + admin, never member) —
      // see the `organizationAc`/`organizationRoles` comment above.
      ac: organizationAc,
      roles: organizationRoles,
      // Longer than the password-reset window on purpose — accepting a
      // workspace invite reasonably takes longer to notice than resetting a
      // forgotten password.
      invitationExpiresIn: 60 * 60 * 24 * 7,
      sendInvitationEmail: async ({ id, email, organization: invitedOrg }) => {
        const acceptUrl = new URL("/login", appBaseUrl());
        acceptUrl.searchParams.set("invitationId", id);
        acceptUrl.searchParams.set("invitedEmail", email);
        acceptUrl.searchParams.set("organizationName", invitedOrg.name);
        // `invitedOrg.name` is workspace-owner-controlled, not ours — escape
        // it before interpolating into the HTML body so a hostile org name
        // (e.g. `Acme"><img src=x onerror=...>`) can't inject markup into an
        // invitee's inbox. The plain-text body needs no escaping.
        const safeOrgName = escapeHtml(invitedOrg.name);
        await enqueueTransactionalEmail({
          to: email,
          subject: `You're invited to join ${invitedOrg.name} on Quiksend`,
          text: `You've been invited to join ${invitedOrg.name} on Quiksend:\n${acceptUrl.toString()}\n\nThis invitation expires in 7 days.`,
          html:
            `<p>You've been invited to join <strong>${safeOrgName}</strong> on Quiksend.</p>` +
            `<p><a href="${acceptUrl.toString()}">Accept invitation</a></p>` +
            `<p>This invitation expires in 7 days.</p>`,
        });
      },
    }),
    apiKey({
      // API keys are owned by the organization, not the individual user who
      // created them — membership changes and offboarding don't orphan keys.
      references: "organization",
      defaultPrefix: "qs_",
      keyExpiration: {
        defaultExpiresIn: 365 * 24 * 60 * 60 * 1000,
        minExpiresIn: 1,
        maxExpiresIn: 365,
      },
      rateLimit: {
        enabled: true,
        timeWindow: 60_000,
        maxRequests: 100,
      },
    }),
    tanstackStartCookies(), // must be last
  ],
});

export type Auth = typeof auth;
