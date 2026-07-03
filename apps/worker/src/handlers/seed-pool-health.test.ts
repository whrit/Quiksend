import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { SYSTEM_KEY } = vi.hoisted(() => ({
  SYSTEM_KEY: Buffer.alloc(32, 9).toString("base64"),
}));

vi.mock("@quiksend/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/config")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SYSTEM_SEED_ENCRYPTION_KEY: SYSTEM_KEY,
      SYSTEM_ADMIN_EMAIL: undefined,
      QUIKSEND_SYSTEM_ORG_ID: undefined,
    },
  };
});

const connectMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
const searchMock = vi.hoisted(() =>
  vi.fn<() => Promise<number[]>>().mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
);

vi.mock("imapflow", () => {
  class ImapFlow {
    connect = connectMock;
    getMailboxLock = vi
      .fn<() => Promise<{ release: () => void }>>()
      .mockResolvedValue({ release: vi.fn<() => void>() });
    search = searchMock;
    logout = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  }
  return { ImapFlow };
});

import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { encryptSeedImapConfig } from "@quiksend/mail";
import { runSeedPoolHealthCheck } from "./seed-pool-health.ts";

describe("seed_pool.health_check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue(undefined);
    searchMock.mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("checks active provider seeds via IMAP", async () => {
    await withTestOrgs(async () => {
      const imap = {
        host: "imap.gmail.com",
        port: 993,
        auth: { user: "seed", pass: "secret" },
        secure: true,
      };

      const [seed] = await db
        .insert(tables.seedInbox)
        .values({
          organizationId: null,
          email: `provider-${randomUUID().slice(0, 6)}@seed.test`,
          gateway: "proofpoint",
          provider: "google_workspace",
          imapConfig: encryptSeedImapConfig(imap, null),
          active: true,
          verifiedAt: new Date(),
        })
        .returning();

      const results = await runSeedPoolHealthCheck();
      expect(results.some((r) => r.seedId === seed!.id && r.ok)).toBe(true);
      expect(connectMock).toHaveBeenCalled();
    });
  });

  it("records failure when IMAP connect fails", async () => {
    await withTestOrgs(async () => {
      connectMock.mockRejectedValueOnce(new Error("connection refused"));

      await db.insert(tables.seedInbox).values({
        organizationId: null,
        email: `bad-${randomUUID().slice(0, 6)}@seed.test`,
        gateway: "mimecast",
        provider: "m365",
        imapConfig: encryptSeedImapConfig(
          {
            host: "imap.gmail.com",
            port: 993,
            auth: { user: "seed", pass: "secret" },
            secure: true,
          },
          null,
        ),
        active: true,
      });

      const results = await runSeedPoolHealthCheck();
      expect(results.some((r) => !r.ok && r.error?.includes("connection refused"))).toBe(true);
    });
  });
});
