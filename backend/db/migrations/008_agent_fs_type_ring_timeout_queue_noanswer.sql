-- ── Phase 1: FreeSWITCH agent type + per-agent ring timeout + queue auto-break ──
-- Additive, idempotent, non-destructive. Preserves all existing agents/queues.
--
-- IMPORTANT (audit RULE 4/5):
--   • agents.agent_type  = APPLICATION endpoint type (internal | gateway) — UNTOUCHED.
--   • agents.fs_agent_type = FREESWITCH mod_callcenter agent type (callback | uuid-standby).
--     These are DISTINCT concepts and must never be conflated.
--   • no_answer_delay_time already exists in schema.sql — NOT re-added here (RULE: no duplicate).
--
-- The migration runner wraps this file in a single transaction. No BEGIN/COMMIT here.
-- All statements are idempotent (IF NOT EXISTS / guarded DO $$).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. FreeSWITCH agent type (callback | uuid-standby) ───────────────────────
-- Default 'callback' == the value FS-CC has always emitted (queueXml.js type="callback",
-- eslService agent add ... callback), so existing agents are unchanged behaviourally.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS fs_agent_type VARCHAR(16) NOT NULL DEFAULT 'callback';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agents_fs_agent_type_check'
       AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_fs_agent_type_check
      CHECK (fs_agent_type IN ('callback', 'uuid-standby'));
  END IF;
END
$$;

-- ── 2. Per-agent ring timeout (seconds) ──────────────────────────────────────
-- NULL = no per-agent override → preserve existing behaviour (mod_callcenter /
-- gateway default ring). A positive value is later applied as a channel variable
-- (leg_timeout) in the generated agent contact. Nullable = backward compatible.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS ring_timeout INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agents_ring_timeout_check'
       AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_ring_timeout_check
      CHECK (ring_timeout IS NULL OR (ring_timeout >= 1 AND ring_timeout <= 600));
  END IF;
END
$$;

-- ── 3. Queue-level auto-action after max-no-answer ───────────────────────────
-- Maps to mod_callcenter's queue param `agent-no-answer-status`. Default 'On Break'
-- == the value currently hardcoded in queueXml.js / eslService, so existing queues
-- are unchanged. This is a QUEUE property (RULE: not an agent-level auto-break).
ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS agent_no_answer_status VARCHAR(32) NOT NULL DEFAULT 'On Break';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'queues_agent_no_answer_status_check'
       AND conrelid = 'public.queues'::regclass
  ) THEN
    ALTER TABLE queues
      ADD CONSTRAINT queues_agent_no_answer_status_check
      CHECK (agent_no_answer_status IN ('Available', 'On Break', 'Logged Out'));
  END IF;
END
$$;
