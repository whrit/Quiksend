import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

/**
 * Better Auth server instance, shared by apps/web (handler + server fns) and, later,
 * the public API. Multi-tenancy comes from the `organization` plugin (org = workspace).
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
  plugins: [
    organization(),
    apiKey(),
    tanstackStartCookies(), // must be last
  ],
});

export type Auth = typeof auth;
