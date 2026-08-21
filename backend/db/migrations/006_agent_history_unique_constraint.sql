-- ── Phase: Agent History Deduplication + Unique Constraint ───────────────────
-- Business rule: one row per (call_uuid, agent_id) in agent_history.
-- FreeSWITCH mod_callcenter may fire repeated agent-offering events for the
-- same agent/call pair during retry cycles. The application layer now uses
-- ON CONFLICT to upsert rather than blindly INSERT on every event.
--
-- This migration:
--   1. Repairs historical data (phantoms, duplicates, zombie calls, RC-4 rows).
--      All repair steps run in a single transaction and are idempotent.
--   2. Adds UNIQUE(call_uuid, agent_id) to enforce the one-row-per-pair model.
--
-- Prerequisites:
--   - Run only after the application code that uses ON CONFLICT is deployed.
--   - Data repair runs first; constraint is added only if no duplicates remain.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Step 1: Consolidate ring_end to MAX across each duplicate group ───────────
-- Winner row keeps earliest ring_start (full offer start) + latest ring_end
-- (end of last attempt), representing the complete offer interval.
UPDATE agent_history ah
SET ring_end    = g.max_ring_end,
    ring_seconds = CASE
      WHEN g.max_ring_end IS NOT NULL
      THEN EXTRACT(EPOCH FROM (g.max_ring_end - ah.ring_start))::INT
      ELSE ah.ring_seconds
    END
FROM (
  SELECT call_uuid, agent_id, winner_id, max_ring_end
  FROM (
    SELECT
      call_uuid, agent_id,
      MAX(ring_end) AS max_ring_end,
      (ARRAY_AGG(id ORDER BY (talk_start IS NOT NULL)::INT DESC, ring_start ASC NULLS LAST))[1] AS winner_id,
      COUNT(*) AS grp_count
    FROM agent_history
    GROUP BY call_uuid, agent_id
  ) grp
  WHERE grp_count > 1 AND max_ring_end IS NOT NULL
) g
WHERE ah.id = g.winner_id;

-- ── Step 2: Backfill talk_start for RC-4 rows ────────────────────────────────
-- Answering agent's bridge-agent-start ESL event was lost.
-- calls.agent_answer_time is the authoritative source.
UPDATE agent_history ah
SET talk_start = c.agent_answer_time
FROM calls c
WHERE ah.call_uuid = c.call_uuid
  AND ah.agent_id  = c.agent_id
  AND ah.talk_start IS NULL
  AND c.disposition = 'answered'
  AND c.agent_answer_time IS NOT NULL;

-- ── Step 3: Recompute talk_seconds where talk_start now available ─────────────
UPDATE agent_history
SET talk_seconds = EXTRACT(EPOCH FROM (talk_end - talk_start))::INT
WHERE talk_start IS NOT NULL
  AND talk_end   IS NOT NULL
  AND talk_seconds IS NULL;

-- ── Step 4: Mark phantom competitor rows missed=true ─────────────────────────
-- Another agent answered the call; these rows were never finalised (RC-3 bug).
UPDATE agent_history ah
SET missed       = true,
    ring_end     = COALESCE(ah.ring_end, c.agent_answer_time),
    ring_seconds = COALESCE(
      ah.ring_seconds,
      EXTRACT(EPOCH FROM (COALESCE(ah.ring_end, c.agent_answer_time) - ah.ring_start))::INT
    )
FROM calls c
WHERE ah.call_uuid = c.call_uuid
  AND ah.missed    = false
  AND ah.talk_start IS NULL
  AND c.disposition = 'answered'
  AND c.agent_id IS DISTINCT FROM ah.agent_id;

-- ── Step 5: Mark abandoned phantom rows missed=true ──────────────────────────
UPDATE agent_history ah
SET missed       = true,
    ring_end     = COALESCE(ah.ring_end, c.end_time),
    ring_seconds = COALESCE(
      ah.ring_seconds,
      EXTRACT(EPOCH FROM (COALESCE(ah.ring_end, c.end_time) - ah.ring_start))::INT
    )
FROM calls c
WHERE ah.call_uuid = c.call_uuid
  AND ah.missed    = false
  AND ah.talk_start IS NULL
  AND c.abandoned  = true;

-- ── Step 6: Delete duplicate rows ────────────────────────────────────────────
-- Winner selection: talk_start IS NOT NULL > ring_start ASC (earliest offer).
DELETE FROM agent_history
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY call_uuid, agent_id
        ORDER BY (talk_start IS NOT NULL)::INT DESC, ring_start ASC NULLS LAST
      ) rn
    FROM agent_history
  ) ranked
  WHERE rn > 1
);

-- ── Step 7: Repair zombie waiting calls ──────────────────────────────────────
UPDATE calls
SET disposition = 'abandoned',
    abandoned   = true
WHERE end_time       IS NOT NULL
  AND disposition    = 'waiting'
  AND agent_answer_time IS NULL;

COMMIT;

-- ── Add UNIQUE constraint (outside transaction — safe after data is clean) ────
-- Fails with clear error if any duplicate pairs remain; never silently drops data.
ALTER TABLE agent_history
  ADD CONSTRAINT agent_history_call_agent_unique UNIQUE (call_uuid, agent_id);
