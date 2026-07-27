import { Nango } from "@nangohq/node";
import { env } from "@quiksend/config";

/**
 * Long-lived Nango client. `env.NANGO_SECRET_KEY` is optional in the schema
 * (later phases turn it on) — call `getNango()` lazily and it throws if the
 * key is missing, giving a clear runtime error rather than a `.env` mystery.
 */
let cached: Nango | null = null;

export function getNango(): Nango {
  if (cached) return cached;
  if (!env.NANGO_SECRET_KEY) {
    throw new Error(
      "NANGO_SECRET_KEY is not set. Configure Nango Cloud credentials before connecting a CRM or mailbox.",
    );
  }
  cached = new Nango({ secretKey: env.NANGO_SECRET_KEY });
  return cached;
}

export type NangoConnectSessionInput = Parameters<Nango["createConnectSession"]>[0];
export type NangoConnectSessionResult = Awaited<ReturnType<Nango["createConnectSession"]>>;
export type NangoReconnectSessionInput = Parameters<Nango["createReconnectSession"]>[0];
export type NangoReconnectSessionResult = Awaited<ReturnType<Nango["createReconnectSession"]>>;

/** Mint a Nango Connect session for a new CRM/mailbox authorization flow. */
export async function createNangoConnectSession(
  sessionProps: NangoConnectSessionInput,
): Promise<NangoConnectSessionResult> {
  return getNango().createConnectSession(sessionProps);
}

/** Mint a Nango Connect session to re-authorize an existing connection. */
export async function createNangoReconnectSession(
  sessionProps: NangoReconnectSessionInput,
): Promise<NangoReconnectSessionResult> {
  return getNango().createReconnectSession(sessionProps);
}

/** Delete a connection in Nango (provider integration id + Nango connection id). */
export async function deleteNangoConnection(
  providerConfigKey: string,
  connectionId: string,
): Promise<void> {
  await getNango().deleteConnection(providerConfigKey, connectionId);
}

/** Test hook to reset the cached client between runs. */
export function resetNangoForTests(): void {
  cached = null;
}
