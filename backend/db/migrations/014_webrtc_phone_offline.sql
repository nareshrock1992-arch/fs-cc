-- ── CP3: per-agent browser phone (WebRTC) + PHONE_OFFLINE system break ─────────
-- Additive, idempotent, non-destructive. The migration runner wraps this file in a
-- single transaction (no BEGIN/COMMIT here).
--
-- The CUSTOMER-level telephony mode is NOT stored here: it is deployment config
-- (TELEPHONY_MODE env, default EXTERNAL_PBX), like BUSINESS_TIMEZONE. The column
-- below is only the per-agent permission; the customer mode always wins
-- (backend/utils/telephony.js effectiveWebrtc()).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Per-agent browser-phone permission. Default false = no change for anyone.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS webrtc_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. A gateway agent can never be WebRTC-enabled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agents_webrtc_internal_only'
       AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_webrtc_internal_only
      CHECK (webrtc_enabled = false OR agent_type = 'internal');
  END IF;
END
$$;

-- 3. System break reason, applied only by the backend when a browser phone is lost.
--    agent_selectable = false → agents cannot choose it (existing /status check).
INSERT INTO break_codes (code, name, description, display_order, agent_selectable, created_by)
VALUES ('PHONE_OFFLINE', 'Phone offline', 'System: browser phone unavailable', 900, false, 'system_seed')
ON CONFLICT (code) DO NOTHING;
