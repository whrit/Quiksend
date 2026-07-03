import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { selectMailboxForSend } from "./mailbox-router.ts";

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

function policy(
  routingPolicy: "off" | "warn" | "enforce",
): import("@quiksend/core/deliverability").DeliverabilityPolicy {
  return {
    routingPolicy,
    contentSanitizerEnabled: routingPolicy !== "off",
  };
}

async function seedEnrollment(
  orgId: string,
  userId: string,
  mailboxId: string,
  anchorMessageId: string | null = null,
) {
  const [prospect] = await db
    .insert(tables.prospect)
    .values({
      organizationId: orgId,
      email: `prospect-${randomUUID().slice(0, 6)}@proofpoint.test`,
      emailGateway: "proofpoint",
    })
    .returning();
  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: "Router test",
      status: "active",
      settings: { mailbox_ids: [mailboxId] },
      createdByUserId: userId,
    })
    .returning();
  const [enrollment] = await db
    .insert(tables.enrollment)
    .values({
      organizationId: orgId,
      sequenceId: sequence!.id,
      prospectId: prospect!.id,
      mailboxId,
      state: "active",
      currentStepIndex: 1,
      anchorMessageId,
      createdByUserId: userId,
    })
    .returning();
  return { enrollment: enrollment!, unsafeMailboxId: mailboxId };
}

describe("selectMailboxForSend", () => {
  beforeEach(() => {
    process.env.QUIKSEND_ENGINE_FAKE_MAIL = "1";
  });

  afterEach(() => {
    delete process.env.QUIKSEND_ENGINE_FAKE_MAIL;
  });

  async function seedMailboxes(orgId: string, userId: string) {
    const unsafe = await db
      .insert(tables.mailbox)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        provider: "gmail",
        address: `unsafe-${randomUUID().slice(0, 6)}@test.local`,
        dailyCap: 50,
        throttleSeconds: 0,
        sendWindow: WIDE_WINDOW,
        status: "active",
      })
      .returning();
    const safeMicrosoft = await db
      .insert(tables.mailbox)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        provider: "microsoft",
        address: `safe-ms-${randomUUID().slice(0, 6)}@test.local`,
        enterpriseSafe: true,
        dailyCap: 50,
        throttleSeconds: 0,
        sendWindow: WIDE_WINDOW,
        status: "active",
      })
      .returning();
    const safeSmtp = await db
      .insert(tables.mailbox)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        provider: "smtp",
        address: `safe-smtp-${randomUUID().slice(0, 6)}@test.local`,
        enterpriseSafe: true,
        dailyCap: 50,
        throttleSeconds: 0,
        sendWindow: WIDE_WINDOW,
        status: "active",
      })
      .returning();
    return {
      unsafe: unsafe[0]!,
      safeMicrosoft: safeMicrosoft[0]!,
      safeSmtp: safeSmtp[0]!,
    };
  }

  it("policy off routes to current mailbox for SEG recipients", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const mailboxes = await seedMailboxes(orgA.id, orgA.userId);
      const { enrollment } = await seedEnrollment(orgA.id, orgA.userId, mailboxes.unsafe.id);

      const decision = await db.transaction((tx) =>
        selectMailboxForSend(
          tx,
          orgA.id,
          enrollment,
          mailboxes.unsafe,
          "proofpoint",
          policy("off"),
        ),
      );

      expect(decision).toEqual({
        kind: "route",
        mailboxId: mailboxes.unsafe.id,
        autoSwapped: false,
        emitEvents: [],
      });
    });
  });

  it("warn + SEG + safe exists + unsafe current auto-swaps to safe mailbox", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const mailboxes = await seedMailboxes(orgA.id, orgA.userId);
      const { enrollment } = await seedEnrollment(orgA.id, orgA.userId, mailboxes.unsafe.id);

      const decision = await db.transaction((tx) =>
        selectMailboxForSend(
          tx,
          orgA.id,
          enrollment,
          mailboxes.unsafe,
          "proofpoint",
          policy("warn"),
        ),
      );

      expect(decision).toMatchObject({
        kind: "route",
        autoSwapped: true,
        emitEvents: expect.arrayContaining(["deliverability.mailbox_auto_swapped"]),
      });
      expect([mailboxes.safeMicrosoft.id, mailboxes.safeSmtp.id]).toContain(
        (decision as { kind: "route"; mailboxId: string }).mailboxId,
      );
    });
  });

  it("warn + SEG + no safe mailboxes routes with delivered_at_risk event", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [unsafe] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: `only-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      const { enrollment } = await seedEnrollment(orgA.id, orgA.userId, unsafe!.id);

      const decision = await db.transaction((tx) =>
        selectMailboxForSend(tx, orgA.id, enrollment, unsafe!, "proofpoint", policy("warn")),
      );

      expect(decision).toEqual({
        kind: "route",
        mailboxId: unsafe!.id,
        autoSwapped: false,
        emitEvents: ["deliverability.delivered_at_risk"],
      });
    });
  });

  it("enforce + SEG + no safe mailboxes skips", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [unsafe] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: `only-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      const { enrollment } = await seedEnrollment(orgA.id, orgA.userId, unsafe!.id);

      const decision = await db.transaction((tx) =>
        selectMailboxForSend(tx, orgA.id, enrollment, unsafe!, "mimecast", policy("enforce")),
      );

      expect(decision).toEqual({
        kind: "skip",
        reason: "no_safe_mailbox_for_gateway",
        emitEvent: true,
      });
    });
  });

  it("anchor-bound enrollment skips auto-swap but emits anchor event", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const mailboxes = await seedMailboxes(orgA.id, orgA.userId);
      const { enrollment } = await seedEnrollment(
        orgA.id,
        orgA.userId,
        mailboxes.unsafe.id,
        "<anchor@test.local>",
      );

      const decision = await db.transaction((tx) =>
        selectMailboxForSend(
          tx,
          orgA.id,
          enrollment,
          mailboxes.unsafe,
          "proofpoint",
          policy("warn"),
        ),
      );

      expect(decision).toMatchObject({
        kind: "route",
        mailboxId: mailboxes.unsafe.id,
        autoSwapped: false,
        emitEvents: expect.arrayContaining([
          "deliverability.anchor_threading_preserved",
          "deliverability.delivered_at_risk",
        ]),
      });
    });
  });

  it("prefers same provider when load counts tie", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [unsafeMicrosoft] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "microsoft",
          address: `unsafe-ms-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      const [safeMicrosoft] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "microsoft",
          address: `safe-ms-${randomUUID().slice(0, 6)}@test.local`,
          enterpriseSafe: true,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      await db.insert(tables.mailbox).values({
        organizationId: orgA.id,
        ownerUserId: orgA.userId,
        provider: "smtp",
        address: `safe-smtp-${randomUUID().slice(0, 6)}@test.local`,
        enterpriseSafe: true,
        dailyCap: 50,
        throttleSeconds: 0,
        sendWindow: WIDE_WINDOW,
        status: "active",
      });

      const { enrollment } = await seedEnrollment(orgA.id, orgA.userId, unsafeMicrosoft!.id);
      const decision = await db.transaction((tx) =>
        selectMailboxForSend(
          tx,
          orgA.id,
          enrollment,
          unsafeMicrosoft!,
          "proofpoint",
          policy("enforce"),
        ),
      );

      expect(decision).toMatchObject({
        kind: "route",
        mailboxId: safeMicrosoft!.id,
      });
    });
  });

  it("non-SEG gateway always routes to current mailbox under enforce", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const mailboxes = await seedMailboxes(orgA.id, orgA.userId);
      const { enrollment } = await seedEnrollment(orgA.id, orgA.userId, mailboxes.unsafe.id);

      const decision = await db.transaction((tx) =>
        selectMailboxForSend(
          tx,
          orgA.id,
          enrollment,
          mailboxes.unsafe,
          "google_workspace",
          policy("enforce"),
        ),
      );

      expect(decision).toEqual({
        kind: "route",
        mailboxId: mailboxes.unsafe.id,
        autoSwapped: false,
        emitEvents: [],
      });
    });
  });
});
