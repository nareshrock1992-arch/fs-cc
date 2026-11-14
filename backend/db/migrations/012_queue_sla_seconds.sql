-- 012_queue_sla_seconds.sql
-- Service level target per queue (seconds): "answered within N seconds".
-- Until now the SLA formulas used queues.max_wait_time (the time a caller may
-- stay in the queue before being taken out). Those are different settings: with
-- max_wait_time = 0 (no limit) every waiting call counted as an SLA breach.
-- Default 20 s (common 80/20 target); editable per queue in the admin portal.
--
-- Migration-runner contract (see db/migrationRunner.js):
--   • No BEGIN/COMMIT here — the runner wraps each file in one transaction.
--   • IF NOT EXISTS keeps it idempotent.

ALTER TABLE queues ADD COLUMN IF NOT EXISTS sla_seconds INTEGER NOT NULL DEFAULT 20;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queues_sla_seconds_range') THEN
    ALTER TABLE queues ADD CONSTRAINT queues_sla_seconds_range CHECK (sla_seconds BETWEEN 1 AND 3600);
  END IF;
END $$;
