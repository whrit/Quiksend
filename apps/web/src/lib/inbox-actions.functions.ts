import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";

function threadKeyMatch(threadKey: string) {
  return or(
    eq(tables.message.providerThreadId, threadKey),
    eq(tables.message.messageIdHeader, threadKey),
    eq(tables.message.id, threadKey),
  );
}

async function getFullyDoneThreadKeys(
  organizationId: string,
  threadKeys: string[],
): Promise<Set<string>> {
  if (threadKeys.length === 0) return new Set();

  const rows = await db.execute<{ thread_key: string }>(sql`
    select coalesce(provider_thread_id, message_id_header, id::text) as thread_key
    from message
    where organization_id = ${organizationId}
      and coalesce(provider_thread_id, message_id_header, id::text) in (${sql.join(
        threadKeys.map((key) => sql`${key}`),
        sql`, `,
      )})
    group by 1
    having count(*) = count(*) filter (where done_at is not null)
  `);

  return new Set(rows.map((row) => row.thread_key));
}

export const getDoneThreadKeys = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ threadKeys: z.array(z.string().min(1)).max(200) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const doneKeys = await getFullyDoneThreadKeys(
      context.orgContext.organizationId,
      data.threadKeys,
    );
    return { threadKeys: [...doneKeys] };
  });

export const markThreadDone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ threadKey: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const now = new Date();

    const updated = await db
      .update(tables.message)
      .set({ doneAt: now })
      .where(and(eq(tables.message.organizationId, organizationId), threadKeyMatch(data.threadKey)))
      .returning({ id: tables.message.id });

    if (updated.length === 0) throw new Error("Thread not found");

    return { ok: true as const, markedCount: updated.length, doneAt: now.toISOString() };
  });
