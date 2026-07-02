import { sql } from "drizzle-orm";
import { db } from "@quiksend/db";
import { enqueueSequenceStep } from "./idempotency.ts";

export async function tick(): Promise<void> {
  const claimed: string[] = [];

  await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      SELECT id FROM enrollment
      WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    `);

    for (const row of rows) {
      await tx.execute(sql`UPDATE enrollment SET next_run_at = NULL WHERE id = ${row.id}`);
      claimed.push(row.id);
    }
  });

  for (const enrollmentId of claimed) {
    await enqueueSequenceStep({ enrollmentId, attempt: 0 });
  }
}
