import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    SYSTEM_SEED_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    QUIKSEND_SYSTEM_ORG_ID: undefined as string | undefined,
    SMTP_HOST: "localhost",
    SMTP_PORT: 1025,
    BETTER_AUTH_URL: "http://localhost:3000",
  },
}));

vi.mock("@quiksend/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/config")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ...mockEnv,
      get QUIKSEND_SYSTEM_ORG_ID() {
        return mockEnv.QUIKSEND_SYSTEM_ORG_ID;
      },
    },
  };
});

const sendMimeMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));

vi.mock("@quiksend/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/mail")>();
  return {
    ...actual,
    sendMime: sendMimeMock,
    createSmtpTransport: vi.fn<() => object>().mockReturnValue({}),
  };
});

import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { encryptSeedImapConfig } from "@quiksend/mail";
import { runSeedPoolLegitMail } from "./seed-pool-legit-mail.ts";

async function insertProviderSeed(email: string) {
  const [row] = await db
    .insert(tables.seedInbox)
    .values({
      organizationId: null,
      email,
      gateway: "proofpoint",
      provider: "google_workspace",
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
      verifiedAt: new Date(),
    })
    .returning();
  return row!;
}

describe("seed_pool.generate_legit_mail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends cross-seed legit mail via SMTP", async () => {
    await withTestOrgs(async ({ orgA }) => {
      mockEnv.QUIKSEND_SYSTEM_ORG_ID = orgA.id;

      await insertProviderSeed(`seed-a-${randomUUID().slice(0, 4)}@pool.test`);
      await insertProviderSeed(`seed-b-${randomUUID().slice(0, 4)}@pool.test`);

      const sent = await runSeedPoolLegitMail();
      expect(sent).toBeGreaterThan(0);
      expect(sendMimeMock).toHaveBeenCalled();

      const events = await db.query.event.findMany({
        where: eq(tables.event.type, "seed_pool.legit_mail_sent"),
      });
      expect(events.length).toBeGreaterThan(0);
    });
  });
});
