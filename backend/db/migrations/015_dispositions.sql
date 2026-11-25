-- ── M1: Wrap-up dispositions and notes (CC-1) ──────────────────────────────
-- Adds (all additive; no existing table or row is changed):
--   1. disposition_codes        — global master catalog of call outcomes
--   2. queue_disposition_codes  — which codes each queue offers (none chosen = all active)
--   3. call_wrapups             — one outcome (+ optional notes) per answered queue call
--   4. system code SYSTEM_DISCONNECTED — set by the backend when the agent's phone
--      dropped during the call
--
-- calls.disposition (answered | abandoned | overflow | no_agent) is the CALL STATE and is
-- deliberately left untouched; the agent's chosen outcome lives in call_wrapups.
-- Outcome code/name are stored as a snapshot (no hard FK), like break codes, so history
-- stays valid after a code is renamed or deactivated.
--
-- No BEGIN/COMMIT: the migration runner wraps this file in one transaction.
-- Idempotent: safe on fresh and existing databases and safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disposition_codes (
  id             SERIAL PRIMARY KEY,
  code           VARCHAR(64)  UNIQUE NOT NULL,   -- e.g. RESOLVED, CALLBACK_NEEDED
  name           VARCHAR(128) NOT NULL,
  description    TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  display_order  INT     NOT NULL DEFAULT 0,
  is_system      BOOLEAN NOT NULL DEFAULT false, -- set by the backend only, never offered to agents
  created_by     VARCHAR(128),
  updated_by     VARCHAR(128),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disposition_codes_active_order
  ON disposition_codes (active, display_order, name);

DROP TRIGGER IF EXISTS trg_disposition_codes_updated_at ON disposition_codes;
CREATE TRIGGER trg_disposition_codes_updated_at BEFORE UPDATE ON disposition_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS queue_disposition_codes (
  queue_id             INT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  disposition_code_id  INT NOT NULL REFERENCES disposition_codes(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_id, disposition_code_id)
);

CREATE TABLE IF NOT EXISTS call_wrapups (
  id                BIGSERIAL PRIMARY KEY,
  call_uuid         VARCHAR(64)  UNIQUE NOT NULL,   -- calls.call_uuid (no FK, like agent_history)
  agent_id          VARCHAR(64)  NOT NULL,
  queue_name        VARCHAR(64),
  disposition_code  VARCHAR(64)  NOT NULL,
  disposition_name  VARCHAR(128) NOT NULL,          -- snapshot at save time
  notes             TEXT,
  source            VARCHAR(16)  NOT NULL DEFAULT 'agent',   -- agent | system
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT call_wrapups_source_chk CHECK (source IN ('agent', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_call_wrapups_agent_time
  ON call_wrapups (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_wrapups_code
  ON call_wrapups (disposition_code, created_at DESC);

DROP TRIGGER IF EXISTS trg_call_wrapups_updated_at ON call_wrapups;
CREATE TRIGGER trg_call_wrapups_updated_at BEFORE UPDATE ON call_wrapups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO disposition_codes (code, name, description, active, display_order, is_system, created_by, updated_by)
VALUES ('SYSTEM_DISCONNECTED', 'Disconnected unexpectedly',
        'Set by the system when the agent''s phone dropped during the call.',
        true, 1000, true, 'system', 'system')
ON CONFLICT (code) DO NOTHING;
