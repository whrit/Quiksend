import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "./client.ts";
import * as tables from "./schema/index.ts";
import { withTestOrgs } from "./testing.ts";

/**
 * Regression tests for message safety primitives: inbound idempotence,
 * partial uniqueness on (mailbox_id, provider_message_id) for inbound only,
 * and archival that preserves message history.
 */
describe("message safety schema", () => {
  describe("inbound message uniqueness", () => {
    it("enforces unique (mailbox_id, provider_message_id) on inbound messages", async () => {
      await withTestOrgs(async ({ orgA }) => {
        const mailboxId = randomUUID();
        const providerMessageId = "gmail_abc123";

        // Create a mailbox
        await db.insert(tables.mailbox).values({
          id: mailboxId,
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "test@example.com",
        });

        // Insert first inbound message with provider ID
        await db.insert(tables.message).values({
          id: randomUUID(),
          organizationId: orgA.id,
          mailboxId,
          direction: "inbound",
          providerMessageId,
          status: "sent",
        });

        // Attempt to insert second inbound message with same mailbox + provider ID
        // Should fail with unique constraint violation (23505)
        await expect(
          db.insert(tables.message).values({
            id: randomUUID(),
            organizationId: orgA.id,
            mailboxId,
            direction: "inbound",
            providerMessageId,
            status: "sent",
          }),
        ).rejects.toMatchObject({ cause: { code: "23505" } });
      });
    });

    it("allows multiple outbound messages without provider IDs", async () => {
      await withTestOrgs(async ({ orgA }) => {
        const mailboxId = randomUUID();

        // Create a mailbox
        await db.insert(tables.mailbox).values({
          id: mailboxId,
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "test@example.com",
        });

        // Insert multiple outbound messages with null provider IDs
        for (let i = 0; i < 3; i++) {
          await db.insert(tables.message).values({
            id: randomUUID(),
            organizationId: orgA.id,
            mailboxId,
            direction: "outbound",
            providerMessageId: null,
            status: "sent",
          });
        }

        // Count messages
        const messages = await db
          .select()
          .from(tables.message)
          .where(eq(tables.message.mailboxId, mailboxId));
        expect(messages).toHaveLength(3);
      });
    });

    it("allows inbound messages with different provider IDs in same mailbox", async () => {
      await withTestOrgs(async ({ orgA }) => {
        const mailboxId = randomUUID();

        // Create a mailbox
        await db.insert(tables.mailbox).values({
          id: mailboxId,
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "test@example.com",
        });

        // Insert inbound messages with different provider IDs
        await db.insert(tables.message).values({
          id: randomUUID(),
          organizationId: orgA.id,
          mailboxId,
          direction: "inbound",
          providerMessageId: "gmail_msg1",
          status: "sent",
        });

        await db.insert(tables.message).values({
          id: randomUUID(),
          organizationId: orgA.id,
          mailboxId,
          direction: "inbound",
          providerMessageId: "gmail_msg2",
          status: "sent",
        });

        // Count messages
        const messages = await db
          .select()
          .from(tables.message)
          .where(eq(tables.message.mailboxId, mailboxId));
        expect(messages).toHaveLength(2);
      });
    });
  });

  describe("mailbox archival", () => {
    it("does not cascade-delete messages when mailbox is archived", async () => {
      await withTestOrgs(async ({ orgA }) => {
        const mailboxId = randomUUID();

        // Create a mailbox
        await db.insert(tables.mailbox).values({
          id: mailboxId,
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "test@example.com",
        });

        // Insert a message
        const messageId = randomUUID();
        await db.insert(tables.message).values({
          id: messageId,
          organizationId: orgA.id,
          mailboxId,
          direction: "inbound",
          status: "sent",
        });

        // Archive the mailbox
        const archiveDate = new Date();
        await db
          .update(tables.mailbox)
          .set({
            status: "archived",
            updatedAt: archiveDate,
          })
          .where(eq(tables.mailbox.id, mailboxId));

        // Verify message still exists
        const message = await db
          .select()
          .from(tables.message)
          .where(eq(tables.message.id, messageId));
        expect(message).toHaveLength(1);
      });
    });
  });

  describe("new safety columns", () => {
    it("stores acceptedAt timestamp for sent messages", async () => {
      await withTestOrgs(async ({ orgA }) => {
        const mailboxId = randomUUID();

        await db.insert(tables.mailbox).values({
          id: mailboxId,
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "test@example.com",
        });

        const acceptedAt = new Date();
        const messageId = randomUUID();

        await db.insert(tables.message).values({
          id: messageId,
          organizationId: orgA.id,
          mailboxId,
          direction: "outbound",
          status: "sent",
          acceptedAt,
        });

        const msg = await db.select().from(tables.message).where(eq(tables.message.id, messageId));
        expect(msg[0]!.acceptedAt).toEqual(acceptedAt);
      });
    });

    it("tracks ingestion attempts for inbound messages", async () => {
      await withTestOrgs(async ({ orgA }) => {
        const mailboxId = randomUUID();

        await db.insert(tables.mailbox).values({
          id: mailboxId,
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "test@example.com",
        });

        const messageId = randomUUID();

        await db.insert(tables.message).values({
          id: messageId,
          organizationId: orgA.id,
          mailboxId,
          direction: "inbound",
          status: "sent",
          ingestionAttempts: 1,
        });

        const msg = await db.select().from(tables.message).where(eq(tables.message.id, messageId));
        expect(msg[0]!.ingestionAttempts).toBe(1);
      });
    });

    it("stores archival metadata on mailbox", async () => {
      await withTestOrgs(async ({ orgA }) => {
        const mailboxId = randomUUID();
        const archiveDate = new Date();

        await db.insert(tables.mailbox).values({
          id: mailboxId,
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "test@example.com",
          archivedAt: archiveDate,
          archivedByUserId: orgA.userId,
          archiveReason: "manual",
        });

        const mailbox = await db
          .select()
          .from(tables.mailbox)
          .where(eq(tables.mailbox.id, mailboxId));
        expect(mailbox[0]!.archivedAt).toEqual(archiveDate);
        expect(mailbox[0]!.archivedByUserId).toBe(orgA.userId);
        expect(mailbox[0]!.archiveReason).toBe("manual");
      });
    });
  });
});
