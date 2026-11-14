-- 013_supervisor_actions.sql
-- Audit trail for supervisor call-control actions (BUG-007: force hang-up of a
-- call stuck in FreeSWITCH). One row per action; never updated or deleted.
--
-- Migration-runner contract (see db/migrationRunner.js):
--   • No BEGIN/COMMIT here — the runner wraps each file in one transaction.
--   • IF NOT EXISTS keeps it idempotent.

CREATE TABLE IF NOT EXISTS supervisor_actions (
  id           BIGSERIAL PRIMARY KEY,
  action       VARCHAR(32)  NOT NULL,
  call_uuid    VARCHAR(64),
  agent_id     VARCHAR(128),
  channels     TEXT[]       NOT NULL DEFAULT '{}',
  result       TEXT,
  performed_by VARCHAR(128) NOT NULL,
  performed_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supervisor_actions_performed_at_idx ON supervisor_actions (performed_at DESC);
