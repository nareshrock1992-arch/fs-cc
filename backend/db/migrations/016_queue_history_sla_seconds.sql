-- 016_queue_history_sla_seconds.sql
-- queue_history.queue_sla_threshold = the queue's service level target (sla_seconds),
-- not max_wait_time (the time a caller may wait before leaving the queue).
--
-- Why a new migration (OPS-4): BUG-006 (migration 012) changed this view inside the
-- baseline file migrate_cdr_views.sql. That broke fresh installs (the baseline runs
-- before 012 adds queues.sla_seconds: "column q.sla_seconds does not exist") and never
-- reached existing databases (baseline files are not re-run). The baseline is restored;
-- this migration applies the change on every database, after 012.
--
-- Same columns, names and types as before (INT -> INT), so CREATE OR REPLACE VIEW is safe.
-- Migration-runner contract: no BEGIN/COMMIT here; idempotent.

CREATE OR REPLACE VIEW queue_history AS
SELECT
  c.call_uuid,
  c.queue_name,
  COALESCE(q.display_name, c.queue_name) AS queue_display_name,
  q.strategy,
  q.sla_seconds                           AS queue_sla_threshold,
  c.queue_enter_time,
  c.agent_answer_time,
  c.end_time,
  c.wait_seconds,
  c.abandoned,
  c.disposition
FROM calls c
LEFT JOIN queues q ON q.name = c.queue_name
WHERE c.queue_name IS NOT NULL;
