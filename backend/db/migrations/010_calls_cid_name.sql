-- 010_calls_cid_name.sql
-- Caller name preservation: persist the calling party's display name (e.g. the
-- SIP / FreeSWITCH Caller-Caller-ID-Name) alongside the caller number, so live
-- monitoring, CDR and reports can show "Caller Name (Number)" where a name was
-- actually captured. Additive and backward-compatible.
--
-- Migration-runner contract (see db/migrationRunner.js):
--   • No BEGIN/COMMIT here — the runner wraps each file in one transaction.
--   • IF NOT EXISTS keeps it idempotent.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS cid_name VARCHAR(128);
