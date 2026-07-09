import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, desc, eq } from "drizzle-orm";

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
  emailAndPassword: { enabled: true },
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET
      ? { microsoft: { clientId: env.MS_CLIENT_ID, clientSecret: env.MS_CLIENT_SECRET } }
      : {}),
  },
  databaseHooks: {
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
    organization(),
    apiKey(),
    tanstackStartCookies(), // must be last
  ],
});

export type Auth = typeof auth;
