import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listInboxThreadsForOrg } from "./inbox.functions.ts";

describe("listInboxThreadsForOrg", () => {
  it("returns one thread per thread key, not one row per message", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "inbox@threads.test",
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      const base = new Date("2026-01-01T12:00:00Z").getTime();
      for (let thread = 0; thread < 10; thread++) {
        for (let msg = 0; msg < 10; msg++) {
          const at = new Date(base + thread * 86_400_000 + msg * 60_000);
          await db.insert(tables.message).values({
            organizationId: orgA.id,
            mailboxId: mailbox.id,
            direction: msg % 2 === 0 ? "outbound" : "inbound",
            subject: `Thread ${thread} message ${msg}`,
            bodyText: `Body ${thread}-${msg}`,
            providerThreadId: `thread-${thread}`,
            status: msg % 2 === 0 ? "sent" : "received",
            sentAt: msg % 2 === 0 ? at : null,
            receivedAt: msg % 2 === 0 ? null : at,
          });
        }
      }

      const { threads } = await listInboxThreadsForOrg(orgA.id, { limit: 5 });
      expect(threads).toHaveLength(5);

      const threadKeys = new Set(threads.map((t) => t.threadKey));
      expect(threadKeys.size).toBe(5);

      const totalMessages = await db.query.message.findMany({
        where: and(
          eq(tables.message.organizationId, orgA.id),
          eq(tables.message.mailboxId, mailbox.id),
        ),
      });
      expect(totalMessages).toHaveLength(100);
    });
  });
});
