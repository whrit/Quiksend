import { env } from "@quiksend/config";
import { decryptSmtpConfig, encryptSmtpConfig } from "./crypto.ts";

export interface SeedImapConfigPlain {
  readonly host: string;
  readonly port: number;
  readonly auth: { readonly user: string; readonly pass: string };
  readonly secure: boolean;
}

export function encryptSeedImapConfig(
  plain: SeedImapConfigPlain,
  organizationId: string | null,
): string {
  const key = resolveSeedEncryptionKey(organizationId);
  return encryptSmtpConfig(plain, key);
}

export function decryptSeedImapConfig(
  cipher: string,
  organizationId: string | null,
): SeedImapConfigPlain {
  const key = resolveSeedEncryptionKey(organizationId);
  return decryptSmtpConfig(cipher, key) as SeedImapConfigPlain;
}

function resolveSeedEncryptionKey(organizationId: string | null): string {
  if (organizationId === null) {
    const systemKey = env.SYSTEM_SEED_ENCRYPTION_KEY;
    if (!systemKey) {
      throw new Error("SYSTEM_SEED_ENCRYPTION_KEY is required for provider-managed seeds");
    }
    return systemKey;
  }
  const key = env.MAILBOX_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("MAILBOX_ENCRYPTION_KEY is required for user seed inboxes");
  }
  return key;
}
