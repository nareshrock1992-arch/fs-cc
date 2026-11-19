# CP3 Design Addendum — Customer and Agent Telephony Selection

Date: 2026-11-19 · Revises `WEBRTC_CP3_AUDIT.md` §5, §6, §8, §9, §10. Design only: no code, no packages, no commits.

## 0. How customer configuration is represented today (verified)
- FS-CC has **no settings/customer/tenant table**. The tables are: `queues`, `agents`, `agent_tiers`, `agent_sessions`, `agent_state_events`, `agent_state_log`, `break_codes`, `audit_log`, `supervisor_actions`, `calls`, `users`.
- One FS-CC installation serves one customer. Customer-wide settings come from **environment variables**, read once in `backend/config/index.js`:
  - `FS_SIP_DOMAIN`, `BUSINESS_TIMEZONE`, `CORS_ORIGIN`, `FS_ESL_*`, `JWT_SECRET`;
  - Docker `.env` in FS-CP.
- Per-agent phone type already exists: `agents.agent_type` (`internal` | `gateway`, migration 005) and `agents.avaya_extension`.

**Options for the customer mode**

| Option | Fits existing model? | Notes |
|---|---|---|
| **A. Env var `TELEPHONY_MODE`** (recommended) | Yes, same as `FS_SIP_DOMAIN`/`BUSINESS_TIMEZONE` | Set at install time, changed by the administrator, applied on backend restart. No new table. |
| B. New single-row `system_settings` table + admin page | New structure | Editable in the UI, but it's a new configuration framework. Not needed for this release. |
| C. Per-queue setting | No | Phone type belongs to agents, not queues. |

Design below uses **Option A**. It doesn't need a customer or tenant framework, so I didn't have to stop on that point.

## 1. Database schema and migration 014

`backend/db/migrations/014_webrtc_phone_offline.sql` is additive, idempotent and has no BEGIN/COMMIT, matching the migration runner's convention:

```sql
-- 1. Per-agent browser-phone permission (internal agents only)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS webrtc_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. Guard: a gateway agent can never be WebRTC-enabled
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='agents_webrtc_internal_only' AND conrelid='public.agents'::regclass) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_webrtc_internal_only
      CHECK (webrtc_enabled = false OR agent_type = 'internal');
  END IF;
END $$;

-- 3. System break reason (not selectable by agents)
INSERT INTO break_codes (code, name, description, display_order, agent_selectable, created_by)
VALUES ('PHONE_OFFLINE', 'Phone offline', 'System: browser phone unavailable', 900, false, 'system_seed')
ON CONFLICT (code) DO NOTHING;
```

- The customer mode is **not** in the database. It comes from `TELEPHONY_MODE` in `config/index.js`, so the migration has nothing customer-level to store.
- Both the customer level and the agent level act as permissions: the mode allows or forbids WebRTC, and `webrtc_enabled` grants it per agent.
- `break_codes` admin edits must not deactivate or rename `PHONE_OFFLINE`, and must not make it selectable. That needs a guard in `breakCodesController.js` (403 on change to a `system_seed` code with `agent_selectable=false`).

**New config** (`backend/config/index.js`):

| Variable | Values | Default | Invalid value |
|---|---|---|---|
| `TELEPHONY_MODE` | `EXTERNAL_PBX`, `FREESWITCH_WEBRTC`, `HYBRID` | `EXTERNAL_PBX` | Startup fails with a clear message, the same style as the `JWT_SECRET` check |
| `SIP_RELAY_UPSTREAM_URL` | `wss://…:7443` | none; required when mode ≠ EXTERNAL_PBX | Startup fails if missing in a WebRTC mode |
| `WEBRTC_GRACE_MS` / `WEBRTC_TICKET_TTL_MS` | ms | 15000 / 30000 | |

## 2. Precedence (customer always wins)

```
effectiveWebrtc(agent) =
     TELEPHONY_MODE != 'EXTERNAL_PBX'
  && agent.agent_type == 'internal'
  && agent.webrtc_enabled == true
  && agent.active == true
```

| Mode | Gateway agent | Internal, `webrtc_enabled=false` | Internal, `webrtc_enabled=true` |
|---|---|---|---|
| EXTERNAL_PBX | no | no | **no** (the stored flag is ignored, never overrides) |
| FREESWITCH_WEBRTC | no | no | yes |
| HYBRID | no | no | yes |

One function, `backend/utils/telephony.js` `effectiveWebrtc(agent, mode)`, is the only place this rule lives. Every backend check calls it.

**FREESWITCH_WEBRTC vs HYBRID:** the permission rule is the same, as the brief asks. They differ only in the admin UI:
- In FREESWITCH_WEBRTC, a new internal agent's "Browser phone" toggle is pre-ticked.
- In HYBRID, it starts unticked, and the admin chooses per agent.
- In both modes an internal agent without WebRTC keeps using whatever is behind their `contact`, for example a desk SIP phone registered to FreeSWITCH.

## 3. API changes (all additive)

| Endpoint / event | Change |
|---|---|
| `POST /api/agent-desk/login` response | `agent` gains `webrtc: { allowed: bool }`. |
| `GET /api/agent-desk/me` | Adds `webrtc_allowed`, `phone_status` (`none`/`online`/`grace`/`offline`). |
| `POST /api/agent-desk/webrtc/ticket` `{kind:'connect'|'reconnect'}` | `403 WEBRTC_NOT_ALLOWED` unless `effectiveWebrtc`. In EXTERNAL_PBX mode the route is **not registered at all**, so it returns 404. Rate limit 10/min/agent. |
| WS `/api/sip-relay` | Only attached when mode ≠ EXTERNAL_PBX. It re-checks `effectiveWebrtc` when the ticket is consumed. |
| `GET /api/telephony/config` (admin, `requireAuth`) | `{ mode }`, so the admin UI can show or hide the toggle. |
| `POST/PUT /api/agents` | Accepts `webrtc_enabled`. 400 when the agent is a gateway agent, or when the mode is EXTERNAL_PBX and the value is `true`. The value is audit-logged in `audit_log` (`agent.webrtc.change`). |
| Socket.IO `agent:phone` | New event: `{agentId, phone}`, sent to room `agent:<id>` and to supervisors. |
| Socket.IO `agent:webrtc-changed` | New event: `{agentId, allowed}`, sent to room `agent:<id>` when an admin changes the flag (§4 timing). |

Existing endpoints and events don't change.

## 4. Agent Desktop behaviour

**Gate.** The phone is initialised only when `me.webrtc_allowed === true`, a value that comes from the backend at runtime.
- The build flag `VITE_WEBRTC_ENABLED` becomes an optional kill switch, default on when unset, so a single image works for every customer.
- With the relay, the WSS address is the page's own origin plus `/cc/api/sip-relay`, or a relative base path. `VITE_SIP_WSS_URL` is no longer needed, and no domain, IP or URL is built in.
- The SIP domain for the REGISTER comes from the ticket response (the backend's `FS_SIP_DOMAIN`).

**When WebRTC is not allowed:**
- `PhoneProvider`/`usePhone` doesn't create a `PhoneService`, so no SIP.js UserAgent is made and no ticket is requested.
- The phone console, keypad, phone status light and registration warnings are not rendered.
- The call strip still shows FS-CC call events from Socket.IO, as it does today for desk-phone agents.

**When allowed:**
- The softphone panel is shown, and the agent enters their SIP password.
- The phone connects through the relay with a ticket.
- The phone status (`Phone ready / reconnecting / offline`) is shown separately from the agent status and break selector.

**Safe timing for changes.** An active call is never torn down.

| Change | When it applies |
|---|---|
| Admin turns an agent **off** | The backend issues no new tickets from that moment. The open relay socket is kept. The desktop gets `agent:webrtc-changed {allowed:false}`, shows "Browser phone will be turned off after this call", and when no call is active it logs the phone out and hides the panel. If the agent is idle, this happens immediately. |
| Admin turns an agent **on** | The desktop gets `{allowed:true}` and shows the phone panel; the agent signs the phone in when ready. No forced change. |
| `TELEPHONY_MODE` change | Applies only when the backend restarts. On restart, relay sockets drop, and the reconnect ticket is refused if the agent is no longer allowed. The desktop then hides the phone. Administrators are told to change the mode outside business hours (customer manual, CP10). |
| Reconnect after disable | Refused (no ticket). Not counted as PHONE_OFFLINE (§5). |

## 5. Backend authorization enforcement

| Point | Check |
|---|---|
| Ticket issue | Valid agent JWT → `effectiveWebrtc` → extension parsed from `contact` → rate limit → ticket bound to `{agentId, extension, exp}` |
| Relay connect | Origin = `CORS_ORIGIN`; ticket exists, unexpired, unused, then deleted; `effectiveWebrtc` checked again |
| Every SIP frame upstream | REGISTER/INVITE/SUBSCRIBE `From` user = ticket extension, otherwise close |
| Logout / `Logged Out` | Close the relay socket, revoke tickets, cancel the grace timer |
| PHONE_OFFLINE | Applied **only** when `effectiveWebrtc` is true **and** the phone had reached `online` in this session. Desk-phone, gateway and EXTERNAL_PBX agents can never get PHONE_OFFLINE. |
| Manual break selection | `PHONE_OFFLINE` is refused by the existing `agent_selectable=true` check |

## 6. Avaya/Cisco physical-phone compatibility (EXTERNAL_PBX)

Nothing changes for these customers. In EXTERNAL_PBX mode:
- No relay WebSocket server is created.
- The ticket route doesn't exist.
- No phone UI is shown, and no PHONE_OFFLINE is applied.
- The `webrtc_enabled` column is ignored.
- Agent login, queue membership, the gateway `contact` used by mod_callcenter, ring timeout, no-answer auto-break, breaks, reports and supervisor views stay exactly as they are today.

The default `EXTERNAL_PBX`, together with the migration's default `webrtc_enabled=false`, means an upgraded installation behaves as before until someone deliberately turns WebRTC on.

## 7. Hybrid deployment behaviour
- In one installation, some agents are gateway agents (Avaya/Cisco desk phones through `sofia/gateway/...`), some are internal agents with FreeSWITCH desk phones, and some are internal agents with the browser phone.
- mod_callcenter rings each agent's `contact` exactly as today. For a WebRTC agent that contact is `user/<ext>@domain`, which FreeSWITCH reaches through the browser registration.
- Supervisor views show the phone status only for WebRTC agents. Other agents show no phone status.
- PHONE_OFFLINE affects only WebRTC agents.
- Reports: PHONE_OFFLINE is counted in break totals and is also a separate `break_code`.

## 8. Migration defaults and rollback

| Item | Default | Effect on existing customers |
|---|---|---|
| `TELEPHONY_MODE` unset | `EXTERNAL_PBX` | No WebRTC anywhere; same as today for desk-phone customers |
| `agents.webrtc_enabled` | `false` | No agent gets the browser phone until enabled |
| `PHONE_OFFLINE` row | inserted, not selectable | Invisible to agents; unused unless WebRTC is on |

**Note for DEV/lab:** the browser phone works on DEV today. After CP3, DEV needs `TELEPHONY_MODE=HYBRID` (or `FREESWITCH_WEBRTC`) in its env, plus the test agent enabled. That will be a separate, owner-approved DEV step at deployment time.

**Rollback:**
1. Set `TELEPHONY_MODE=EXTERNAL_PBX` and restart. WebRTC is off everywhere and data is unchanged.
2. Untick individual agents.
3. Migration 014 is additive. The column, constraint and break code can stay unused, so no down-migration is needed.
4. Reverting the CP3 commits restores the current code.

PHONE_OFFLINE history rows remain valid because break history stores a name snapshot.

## 9. Test scenarios

All of these are automated unit tests with a mocked DB, ESL and upstream, plus agent-desktop component tests. They are repeated manually in CP8 on a test environment.

| # | Mode | Scenario | Expected |
|---|---|---|---|
| 1 | EXTERNAL_PBX | Internal agent with `webrtc_enabled=true` in DB | `/me.webrtc_allowed=false`; ticket route 404; relay not attached; no phone UI; no SIP.js created |
| 2 | EXTERNAL_PBX | Admin tries to enable WebRTC | 400 |
| 3 | EXTERNAL_PBX | Gateway agent login, queue, break, call events, reports | Identical to current behaviour (existing tests stay green) |
| 4 | FREESWITCH_WEBRTC | Enabled internal agent | Ticket issued; relay connects; phone online |
| 5 | FREESWITCH_WEBRTC | Internal agent not enabled | 403 ticket; no phone UI |
| 6 | Any WebRTC mode | Gateway agent | Cannot be enabled (400 + DB constraint); no phone UI |
| 7 | HYBRID | Mixed: gateway, internal-desk, internal-WebRTC | Only the WebRTC agent gets tickets or the phone UI; the others are unchanged |
| 8 | HYBRID / FS_WEBRTC | Ticket reused, expired, other agent's ticket, other extension in REGISTER | Rejected or closed |
| 9 | HYBRID / FS_WEBRTC | 11 ticket requests in 1 minute | 11th → 429 |
| 10 | HYBRID / FS_WEBRTC | Phone drops under 15 s / over 15 s while Available / while on LUNCH / during a call | No change / On Break PHONE_OFFLINE / LUNCH kept / applied after the call |
| 11 | HYBRID / FS_WEBRTC | Phone recovers | Phone online; agent stays On Break |
| 12 | HYBRID / FS_WEBRTC | Admin disables during a call / while idle | Call continues, phone off after it / phone off now |
| 13 | Any | Agent tries `/status` with `PHONE_OFFLINE` | 400 |
| 14 | Any | Admin edits or deactivates `PHONE_OFFLINE` | Refused |
| 15 | Any | Invalid `TELEPHONY_MODE`, or WebRTC mode without `SIP_RELAY_UPSTREAM_URL` | Backend refuses to start with a clear message |
| 16 | Any | Logs during the ticket and relay flow | No password, no full ticket |

The regression suites (426 backend, 200 agent-desktop) must stay green.

## 10. Revised implementation order
- **CP3-B:**
  - `TELEPHONY_MODE` config and the `utils/telephony.js` rule;
  - migration 014;
  - shared contact parser;
  - ticket store and endpoint;
  - admin agent toggle and `GET /api/telephony/config`;
  - break-code guard;
  - tests for scenarios 1–3, 5, 6, 8, 9, 13–15.
- **CP3-C:** the `ws` package (dependency and security review first), the relay and its tests.
- **CP3-D:** phone presence, PHONE_OFFLINE, the `agent:phone` and `agent:webrtc-changed` events, tests for scenarios 10–12.
- **CP3-E:** Agent Desktop runtime gate, relay URL, phone status separation, safe-timing handling, tests.
- **CP3-F:** full regression run, docs (env vars, nginx upgrade note for FS-CP CP4, DEV env note), report.

## 11. Decision needed
- Approve **Option A**: the customer mode is the env var `TELEPHONY_MODE`, default `EXTERNAL_PBX`, and changes apply on restart.
- The alternative, an admin-editable settings table (Option B), would be a new configuration framework and is not recommended for this release.
