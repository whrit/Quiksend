import { beforeEach, describe, expect, it, vi } from "vitest";

const { USER_KEY, SYSTEM_KEY } = vi.hoisted(() => ({
  USER_KEY: Buffer.alloc(32, 1).toString("base64"),
  SYSTEM_KEY: Buffer.alloc(32, 2).toString("base64"),
}));

vi.mock("@quiksend/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/config")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      MAILBOX_ENCRYPTION_KEY: USER_KEY,
      SYSTEM_SEED_ENCRYPTION_KEY: SYSTEM_KEY,
    },
  };
});

import {
  decryptSeedImapConfig,
  encryptSeedImapConfig,
  type SeedImapConfigPlain,
} from "./seed-crypto.ts";

const sample: SeedImapConfigPlain = {
  host: "imap.gmail.com",
  port: 993,
  auth: { user: "seed", pass: "secret" },
  secure: true,
};

describe("seed IMAP crypto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("round-trips user seed config with MAILBOX_ENCRYPTION_KEY", () => {
    const cipher = encryptSeedImapConfig(sample, "org_user_123");
    expect(decryptSeedImapConfig(cipher, "org_user_123")).toEqual(sample);
  });

  it("round-trips provider seed config with SYSTEM_SEED_ENCRYPTION_KEY", () => {
    const cipher = encryptSeedImapConfig(sample, null);
    expect(decryptSeedImapConfig(cipher, null)).toEqual(sample);
  });

  it("rejects cross-key decryption between user and provider domains", () => {
    const userCipher = encryptSeedImapConfig(sample, "org_user_123");
    const providerCipher = encryptSeedImapConfig(sample, null);

    expect(() => decryptSeedImapConfig(userCipher, null)).toThrow(/decrypt|auth|key/i);
    expect(() => decryptSeedImapConfig(providerCipher, "org_user_123")).toThrow(
      /decrypt|auth|key/i,
    );
  });
});
