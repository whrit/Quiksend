import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { evaluateProtectedAccess, type ProtectedAccessResult } from "./protected-guard.ts";
import { auth } from "@quiksend/auth";

export type { ProtectedAccessResult };

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  return auth.api.getSession({ headers });
});

/**
 * Server-fn wrapper around `evaluateProtectedAccess`. Called by
 * `_protected.tsx`'s `beforeLoad`, which runs on both server AND client — the
 * client version goes through an RPC bridge so `@quiksend/db` never leaks into
 * the browser bundle.
 */
export const getProtectedContext = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return evaluateProtectedAccess(session);
});
