-- 009_agents_agent_id_lower_unique.sql
-- Case-insensitive agent login (see agentDeskController.agentLogin).
--
-- The Agent Desktop login now matches `LOWER(agent_id) = LOWER($1)`. To keep that
-- lookup unambiguous, agent_id values must be unique case-insensitively. This
-- functional unique index enforces that and prevents two agent IDs that differ
-- only by case (e.g. `Agent1@default.com` vs `agent1@default.com`) from coexisting.
--
-- Migration-runner contract (see db/migrationRunner.js):
--   • No BEGIN/COMMIT here — the runner wraps each file in one transaction.
--   • Therefore CREATE INDEX CONCURRENTLY is NOT used (it is illegal inside a
--     transaction block). A plain CREATE UNIQUE INDEX is fully transactional and
--     fine for the small `agents` table (brief lock, rolls back cleanly on error).
--   • IF NOT EXISTS keeps it idempotent.
--
-- PRE-DEPLOY REQUIREMENT: run the read-only collision check first —
--   SELECT LOWER(agent_id) AS normalized_agent_id, COUNT(*) AS total
--   FROM agents GROUP BY LOWER(agent_id) HAVING COUNT(*) > 1;
-- If any rows are returned, resolve the duplicates BEFORE applying this migration;
-- otherwise this CREATE UNIQUE INDEX will (correctly) fail and the transaction
-- will roll back, leaving the schema unchanged.

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_agent_id_lower_unique
  ON agents (LOWER(agent_id));
