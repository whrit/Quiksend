import { sql } from "drizzle-orm";
import { db } from "@quiksend/db";
import { enqueueSequenceStep } from "./idempotency.ts";

const CLAIM_BATCH_SIZE = 100;
const CLAIM_BUDGET_PER_TICK = 1000;

/** Sentinel TTL — if a step job stalls, the enrollment reappears for the scheduler. */
const PROCESSING_SENTINEL_MINUTES = 15;

export async function tick(): Promise<void> {
  const claimed: string[] = [];
  let totalClaimed = 0;

  while (totalClaimed < CLAIM_BUDGET_PER_TICK) {
    const batch: string[] = [];

    await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT id FROM enrollment
        WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now()
        ORDER BY next_run_at
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);

      if (rows.length === 0) return;

      const ids = rows.map((row) => row.id);
      // Processing sentinel instead of NULL: self-heals if enqueue/step fails (CR-003).
      await tx.execute(sql`
        UPDATE enrollment
        SET next_run_at = now() + (${PROCESSING_SENTINEL_MINUTES} * interval '1 minute')
        WHERE id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      `);
      batch.push(...ids);
    });

    if (batch.length === 0) break;

    claimed.push(...batch);
    totalClaimed += batch.length;

    if (batch.length < CLAIM_BATCH_SIZE) break;
  }

  for (const enrollmentId of claimed) {
    await enqueueSequenceStep({ enrollmentId, attempt: 0 });
  }
}
