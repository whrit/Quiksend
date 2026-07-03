import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

vi.mock("@quiksend/queue", () => ({
  enqueue: vi.fn<() => Promise<void>>(),
}));

vi.mock("../sequence/mailbox-adapter.ts", () => ({
  createMailboxAdapter: vi.fn<() => { send: ReturnType<typeof vi.fn> }>(() => ({
    send: vi.fn<() => Promise<void>>(),
  })),
}));

vi.mock("../sequence/workspace-postal.ts", () => ({
  getWorkspacePostalAddress: vi.fn<() => Promise<string>>(async () => "123 Main St"),
}));

vi.mock("../sequence/render-template.ts", () => ({
  renderTemplate: vi.fn<(template: string) => string>((template) => template),
  stripHtml: vi.fn<(html: string) => string>((html) => html.replace(/<[^>]+>/g, "")),
}));

import { enqueue } from "@quiksend/queue";
import { materializeCanarySend } from "./canary-send.ts";

const WIDE_WINDOW = {
  timezone: "UTC",
  window: {
    sun: [[0, 24]],
    mon: [[0, 24]],
    tue: [[0, 24]],
    wed: [[0, 24]],
    thu: [[0, 24]],
    fri: [[0, 24]],
    sat: [[0, 24]],
  },
};

describe("materializeCanarySend domain gap throttle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QUIKSEND_ENGINE_FAKE_MAIL = "1";
    process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-unsubscribe-secret-32-chars!!";
  });

  afterEach(() => {
    delete process.env.QUIKSEND_ENGINE_FAKE_MAIL;
  });

  it("re-enqueues when the 5-minute domain gap is active", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const domain = `gap-${randomUUID().slice(0, 6)}.test`;
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: `sender-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Gap seq",
          status: "active",
          settings: { mailbox_ids: [mailbox!.id] },
          createdByUserId: orgA.userId,
        })
        .returning();
      const [prospect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: `p@${domain}`,
        })
        .returning();
      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          prospectId: prospect!.id,
          mailboxId: mailbox!.id,
          state: "active",
          createdByUserId: orgA.userId,
        })
        .returning();
      const [seedInbox] = await db
        .insert(tables.seedInbox)
        .values({
          organizationId: orgA.id,
          email: `seed@${domain}`,
          gateway: "proofpoint",
          provider: "test",
          imapConfig: "mock-imap-config-ciphertext",
          active: true,
        })
        .returning();
      await db.insert(tables.sequenceStep).values({
        organizationId: orgA.id,
        sequenceId: sequence!.id,
        stepIndex: 0,
        stepType: "auto_email",
        config: { subject: "Hi", body_template: "<p>Hello</p>" },
      });

      await db.insert(tables.sendReservation).values({
        mailboxId: mailbox!.id,
        enrollmentId: enrollment!.id,
        windowStart: new Date(Date.now() - 60_000),
        recipientDomain: domain,
        status: "sent",
      });

      const [canary] = await db
        .insert(tables.canarySend)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          mailboxId: mailbox!.id,
          seedInboxId: seedInbox!.id,
          canaryToken: randomUUID(),
          stepIndex: 0,
          subject: "Canary",
        })
        .returning();

      await materializeCanarySend(canary!.id);
      expect(enqueue).toHaveBeenCalledWith(
        "canary.send",
        { canarySendId: canary!.id },
        expect.objectContaining({ startAfter: expect.any(Number) }),
      );
    });
  });
});
