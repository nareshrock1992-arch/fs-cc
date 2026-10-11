-- Caller name preservation migration
-- Adds a column to persist the calling party's display name (e.g. the SIP /
-- FreeSWITCH Caller-Caller-ID-Name) alongside the caller number, so historical
-- calls, CDR and reports can show "Caller Name (Number)" where a name was
-- actually captured. Additive and idempotent.
--
-- Run once on the PostgreSQL server (NOT executed automatically):
--   psql -U your_user -d your_db -f migrate_caller_name.sql

ALTER TABLE calls ADD COLUMN IF NOT EXISTS cid_name VARCHAR(128);
