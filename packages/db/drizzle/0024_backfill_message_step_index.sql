-- Backfill message.sequence_step_index for engine sends predating the column.
--
-- This is EXACT, not a heuristic. The worker stamps every automated send with
-- idempotency_key = sha256("<enrollmentId>|<stepId>|<attempt>")
-- (apps/worker/src/sequence/idempotency.ts). The hash is not reversible, but it
-- IS recomputable: for a given enrollment we know its sequence's steps and the
-- small range of attempt numbers, so we can regenerate every candidate key and
-- match it against the stored value. A match identifies the step with certainty.
--
-- Manual sends (compose, inbox reply) never set idempotency_key, so
-- `idempotency_key IS NOT NULL` cleanly separates engine sends from manual ones
-- and manual messages are correctly left NULL.
--
-- Attempts are bounded by the queue retry limit (5); 0..20 is generous headroom.
-- Postgres sha256(convert_to(txt,'UTF8')) is byte-identical to Node's
-- crypto.createHash('sha256').update(txt) — verified before writing this.

WITH candidate_keys AS (
    SELECT
        e.id                AS enrollment_id,
        s.step_index        AS step_index,
        encode(
            sha256(convert_to(e.id::text || '|' || s.id::text || '|' || a::text, 'UTF8')),
            'hex'
        )                   AS idempotency_key
    FROM enrollment e
    JOIN sequence_step s
      ON s.sequence_id = e.sequence_id
     AND s.organization_id = e.organization_id
    CROSS JOIN generate_series(0, 20) AS a
)
UPDATE message m
SET sequence_step_index = c.step_index
FROM candidate_keys c
WHERE m.sequence_step_index IS NULL
  AND m.idempotency_key IS NOT NULL
  AND m.enrollment_id = c.enrollment_id
  AND m.idempotency_key = c.idempotency_key;
