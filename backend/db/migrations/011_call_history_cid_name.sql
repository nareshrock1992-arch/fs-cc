-- 011_call_history_cid_name.sql
-- Expose the persisted caller display name (calls.cid_name, added in 010) on the
-- call_history CDR view so CDR/Call-History reports can show "Caller Name (Number)".
-- Additive: cid_name is appended at the END of the view's column list (the only
-- column change CREATE OR REPLACE VIEW permits), so existing consumers are
-- unaffected.
--
-- Migration-runner contract: no BEGIN/COMMIT here (the runner wraps each file in
-- one transaction).

CREATE OR REPLACE VIEW call_history AS
SELECT
  c.call_uuid,
  c.ani,
  c.dnis,
  c.vdn,
  c.queue_name,
  c.agent_id,
  c.ivr_path,
  c.start_time,
  c.queue_enter_time,
  c.agent_answer_time,
  c.end_time,
  c.wait_seconds,
  c.talk_seconds,
  c.abandoned,
  c.disposition,
  c.cid_name
FROM calls c;
