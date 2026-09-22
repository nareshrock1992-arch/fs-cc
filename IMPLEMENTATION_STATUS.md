# FS-CC Agent Management + Monitoring — Implementation Status

Tracking file for the phased implementation. A phase is only COMPLETE when
implemented AND tested AND regression-checked. Live-FreeSWITCH / live-Postgres
verification is marked separately because it cannot run in the dev-laptop
environment (no FS/PG here) and must be validated on the DEV server.

| Phase | Title | Status |
|---|---|---|
| 0  | Final discovery / UNKNOWN items            | COMPLETE (read-only) |
| 1  | Database (additive migration)              | IMPLEMENTED — pending live-PG apply |
| 2  | Backend agent model/API                    | IMPLEMENTED + UNIT-TESTED (DB persist pending DEV PG) |
| 3  | FreeSWITCH ESL                             | IMPLEMENTED + UNIT-TESTED (live ESL pending DEV) |
| 4  | Contact / ring timeout                     | IMPLEMENTED + UNIT-TESTED (live call pending DEV) |
| 5  | XML persistence + DB↔ESL consistency       | IMPLEMENTED + UNIT-TESTED (live reload pending DEV) |
| 6  | Agent configuration UI                     | IMPLEMENTED + BUILD-TESTED |
| 7  | Status / Agent Desktop compatibility       | VERIFIED (statuses unchanged; 58 desktop/session tests pass; On Demand OUT OF SCOPE) |
| 8  | Queue / Tier management                    | IMPLEMENTED — backend UNIT-TESTED + frontend BUILD-TESTED (live FS pending DEV) |
| 9  | Live agent monitoring                      | PENDING |
| 10 | Live counter reconciliation                | PENDING |
| 11 | Statistics tab                             | PENDING |
| 12 | Performance tab                            | PENDING |
| 13 | History tab                                | PENDING |
| 14 | Socket.IO / realtime                       | PENDING |
| 15 | RBAC                                        | PENDING |
| 16 | Configuration synchronization              | PENDING |
| 17 | Regression testing                         | PENDING |
| 18 | Integration test                           | PENDING |
| 19 | Production hardening                        | PENDING |
| 20 | Final audit                                | PENDING |

---

## Phase 0 — Discovery (COMPLETE, read-only)

Resolved UNKNOWNs:
- **Agent statuses** — admin (`agentsController.VALID_STATUSES`) and Agent Desktop
  (`agentDeskController.VALID_STATUSES`) both = `['Available','On Break','Logged Out']`.
  No "Available (On Demand)" anywhere.
- **Session accounting** — `agentSessionService.handleStatusTransition` writes the status
  verbatim into `agent_state_events`, whose schema has
  `CHECK (status IN ('Available','On Break'))` (migration 002). `reconcileOnStartup`
  likewise. Sessions open on non-Logged-Out, close on Logged Out.
- **Break accounting** — break_codes table + break_code/break_name snapshot on
  agent_state_events (migration 007); Agent Desktop `POST /agent-desk/status` handles it.
- **Migrations** — 001 sessions, 002 state_events (status CHECK), 003 reporting indexes,
  004 user_permissions, 005 agent_type(internal|gateway)+PAI normalization, 006 agent_history
  unique constraint, 007 break mgmt + calls.direction + audit_log.
- **Route permissions** — existing named permissions: `change_agent_state`,
  `manage_break_codes`, `view_reports`. Agent CRUD = `requireAdmin`. Read (list/get/history)
  = any authenticated user. No `view_agents`/`view_live_agents`/`force_agent_state` yet.
- **Tier APIs** — `queuesController` exposes queue CRUD + `getQueue` (returns its tiers).
  There is **no** dedicated tier add/remove/set-level/set-position/set-state API endpoint;
  tiers are currently managed indirectly. (Phase 8 will add explicit tier APIs.)
- **Monitoring** — `GET /api/stats/live-agents` (PG-derived) + Socket.IO events
  (`agent:status/state/offering/no-answer`, `call:*`). FS live counters not consumed.

### Implementation map (source of truth)
- Config: `agents`, `queues`, `agent_tiers` (PG) ⇄ FS via `eslService` + `queueXml`.
- Runtime: FreeSWITCH mod_callcenter; mirrored into `agents.status/state`.
- History: `agent_history`, `calls`, `agent_sessions`, `agent_state_events`, `agent_state_log`.
- Realtime: `ccEvents` (eslService) → `socketService` → Socket.IO (broadcast + agent rooms).

### RESOLVED (scope correction) — "Available (On Demand)" is OUT OF SCOPE
Per the user's scope correction, the application status model stays exactly:
`Available` | `On Break` | `Logged Out`. "Available (On Demand)" is NOT added.
Therefore the `agent_state_events CHECK (status IN ('Available','On Break'))` conflict
does not arise and Phase 7 is unblocked. Migration 008 was edited (before any apply)
to keep the queue `agent_no_answer_status` CHECK to the three in-scope statuses.
The three separate concepts remain: application status (3 values) · FreeSWITCH agent
type (callback|uuid-standby, `fs_agent_type`) · endpoint type (internal|gateway, `agent_type`).

---

## Phase 1 — Database (IMPLEMENTED)

Migration: `backend/db/migrations/008_agent_fs_type_ring_timeout_queue_noanswer.sql`
- `agents.fs_agent_type VARCHAR(16) NOT NULL DEFAULT 'callback'` + CHECK(callback|uuid-standby).
- `agents.ring_timeout INT NULL` + CHECK(NULL or 1..600).
- `queues.agent_no_answer_status VARCHAR(32) NOT NULL DEFAULT 'On Break'` + CHECK(4 statuses).
- `agent_type` (internal|gateway) **untouched**; `no_answer_delay_time` **not duplicated** (exists in schema.sql).
- Idempotent (ADD COLUMN IF NOT EXISTS + guarded constraints); runner-compatible (no BEGIN/COMMIT).

Files changed: +1 (migration). DB: 3 additive columns + 3 CHECK constraints. APIs: none. ESL: none. UI: none.
Tests: SQL is idempotent + matches migrationRunner contract (numbered, sorted, wrapped).
Live-PG apply + `\d agents`/`\d queues` verification: **pending DEV** (no Postgres in dev-laptop env).

Regression: none — purely additive; defaults equal current hardcoded values, so existing
create/update/XML/ESL paths behave identically until later phases read the new columns.

[IMPLEMENTED] [NOT YET LIVE-TESTED — DEV PG REQUIRED] [REGRESSION: none by construction]

---

## Phase 2 — Backend agent model/API (IMPLEMENTED + UNIT-TESTED)
Files: `backend/controllers/agentsController.js`, `backend/src/__tests__/unit/agentConfigValidation.test.js`.
- `validateAgentConfig()` (exported) — fs_agent_type ∈ {callback,uuid-standby}; ring_timeout null|1..600; timing ints 0..86400.
- create/update accept + persist `fs_agent_type`, `ring_timeout`, `no_answer_delay_time`; list/get expose them. `agent_type` (internal|gateway) untouched; PAI preserved.
- ESL: create uses `agentAdd(id,contact,fsAgentType)` + generic `agentSetParam('no_answer_delay_time',…)`; fs_agent_type/ring_timeout DB-persisted (live-applied in Phases 3–5).
Tests: 15 new. Regression: full suite green.

## Phase 3 — FreeSWITCH ESL (IMPLEMENTED + UNIT-TESTED)
Files: `backend/services/eslService.js`, `backend/controllers/agentsController.js`, `backend/routes/agents.js`, `backend/src/__tests__/unit/eslAgentLive.test.js`.
- `cc.tierSetLevel` / `cc.tierSetPosition` (native mod_callcenter commands).
- `cc.agentLive(id)` + exported `normalizeAgentLive(row)` — LIVE snapshot over existing `agent list` parser; numeric coercion; missing cols → null (version-drift safe); `_raw` kept. LIVE-only (never historical).
- `GET /api/agents/:agentId/live` (read-only) — graceful when ESL offline / agent absent (`{live:null, esl_connected}`).
Tests: 8 new. No second ESL connection created.

## Phase 4 — Contact / ring timeout (IMPLEMENTED + UNIT-TESTED)
Files: `backend/controllers/agentsController.js`, `backend/src/__tests__/unit/agentRingTimeout.test.js`.
- `buildContact` extended (not replaced): `ringTimeout` → `{sip_cid_type=pid,leg_timeout=N}…` in the SAME var block. PAI never duplicated; idempotent.
- create passes ringTimeout; update rebuilds contact on contact-change OR ring-only change (re-derives from stored contact). Internal + gateway + legacy paths covered.
Tests: 7 new (incl. PAI-single-block + idempotent rebuild + clear-override).

## Phase 5 — XML persistence + DB↔ESL consistency (IMPLEMENTED + UNIT-TESTED)
Files: `backend/utils/queueXml.js`, `backend/services/eslService.js`, `backend/src/__tests__/unit/queueXmlGeneration.test.js`.
- `queueXml`: agent `type` from `fs_agent_type` (fallback callback), added `no-answer-delay-time`, queue `agent-no-answer-status` from DB (fallback On Break). Contact carries leg_timeout (Phase 4).
- `pushToFreeSWITCH` startup sync now DB-driven for the SAME fields → XML and ESL paths reconstruct identical config from PostgreSQL (drift removed). Tiers/PAI/queue behavior unchanged.
Tests: 2 new. Full backend suite: **273 passed (20 files)**.

### Remaining (Phases 6–20)
Predominantly frontend (admin `Agents.jsx` + agent-desktop) and live-FreeSWITCH integration:
6 Config UI · 7 Desktop compat (statuses stay Available/On Break/Logged Out — On Demand OUT OF SCOPE) ·
8 Queue/Tier UI (uses new `tierSetLevel/Position` + queue `agent_no_answer_status`) · 9 Live monitoring ·
10 Live-counter poller (`cc.agentLive`) · 11 Statistics (LIVE) · 12 Performance (reuse agentReportService) ·
13 History · 14 Socket.IO · 15 RBAC (view_agents/view_live_agents) · 16 Sync verification · 17–20 tests/hardening/audit.
Live ESL/PG/agent-desktop/UI verification is DEV-server work (no FS/PG/browser build in this env).

## Phase 6 — Agent Configuration UI (IMPLEMENTED + BUILD-TESTED)
Files: `frontend/src/pages/Agents.jsx` (existing form extended — no new UI/design system).
- Added: **FreeSWITCH Agent Type** select (Callback / UUID Standby) — clearly separate from
  **Endpoint Type** (Internal SIP / Gateway); **Ring Timeout (sec)** (blank = no override);
  **No Answer Delay (sec)**. EMPTY_FORM + openEdit mapping updated; camelCase keys match the API.
- Client validation mirrors backend (ring_timeout 1..600 or blank; timing min=0); backend remains authoritative.
- Save path unchanged (existing `AgentsApi.create/update` → API → PG → FS); existing error handling preserved
  (form shows backend error; no false success).
UI: agent create/edit modal. APIs: none new (reuses create/update). DB/FS: none.
Tests: frontend `npm run build` **exit 0** (2409 modules) → [BUILD TESTED]. Not DEV/live tested.
Known limitation: full tabbed Agent Details (Queue/Statistics/Performance/Monitoring/History) are later
phases (8–13); Phase 6 delivers the Configuration fields into the existing modal as specified.

## Phase 7 — Status / Agent Desktop compatibility (VERIFIED)
No code change required. "Available (On Demand)" is OUT OF SCOPE, so status vocabulary is unchanged:
both `agentsController` and `agentDeskController` still use ['Available','On Break','Logged Out'];
`agent_state_events` CHECK untouched; `agentSessionService` untouched. New fields (fs_agent_type,
ring_timeout, no_answer_delay_time) are admin-config only and do not touch login/logout/break/session.
Tests: agentDeskBreak + agentSessionBreak + agentSessionService + agentHistoryReporting = **58 passed**.
[UNIT TESTED] Live agent-desktop login/break/resume = pending DEV.

### Remaining (Phases 8–20)
8 Queue/Tier UI (wire new `tierSetLevel/Position` + queue `agent_no_answer_status`; add tier APIs) ·
9 Live monitoring UI · 10 live-counter poller (`cc.agentLive`) · 11 Statistics (LIVE) ·
12 Performance (reuse agentReportService) · 13 History · 14 Socket.IO · 15 RBAC ·
16 sync verification · 17–20 regression/integration/hardening/final audit.
Predominantly frontend + live-FreeSWITCH; verification is DEV-server work.

## Phase 8 — Queue / Tier management (IMPLEMENTED)
Audit: tier add/remove ALREADY existed (`POST/DELETE /queues/:name/tiers`, `agent_tiers` upsert). Gaps
filled additively (no new tables/services/ESL connections).
Backend files: `backend/controllers/queuesController.js`, `backend/routes/queues.js`, `backend/src/__tests__/unit/queueTierValidation.test.js`.
- `validateTier()` — level 1..10, position 1..100, state ∈ TIER_STATES (['Ready','Standby','No Answer']).
- `QUEUE_NO_ANSWER_STATUSES` = ['Available','On Break','Logged Out'] (NO On Demand).
- `addTier`: validates; upserts DB; ESL `tierAdd` + `tierSetLevel` + `tierSetPosition` (so existing-tier level/position live-sync); returns `fs_synced` (+ `fs_error`).
- `setTier` (NEW `PUT /queues/:name/tiers/:agentId`): level/position persisted; **state runtime-only** via `cc.tierSetState` (not persisted → no schema change/drift); validates; `fs_synced` honest flag.
- create/update queue accept `agentNoAnswerStatus` → validated + persisted (`queues.agent_no_answer_status`, Phase 1) + ESL `queue set agent-no-answer-status`.
APIs: +1 (`PUT …/tiers/:agentId`); create/update/addTier extended. DB: none new (uses agent_tiers + Phase-1 column). ESL: reuses Phase-3 `tierSetLevel/tierSetPosition/tierSetState`.
Frontend files: `frontend/src/api/client.js` (`Queues.setTier`), `frontend/src/pages/Queues.jsx`:
- Queue modal: "Action after Max No Answer" selector (3 statuses).
- Tier modal rows: inline Level / Position inputs + "Set state…" dropdown; surfaces `fs_synced:false` as a visible warning (no false success).
Tests: backend **281 passed (21 files)** [UNIT TESTED]; frontend `npm run build` exit 0 [BUILD TESTED].
Known limitations / UNVERIFIED:
- Tier state values (`Ready`/`Standby`/`No Answer`) and `tier set state`/`set level`/`set position` are
  **UNVERIFIED against the installed FreeSWITCH version — LIVE FREESWITCH TEST REQUIRED**. Not faked; not invented.
- Live tier-state DISPLAY (current FS tier state per agent) is deferred to Phase 9/10 (read via `cc.tierList`);
  Phase 8 covers SET + the level/position display.
- DB↔FS on failure: DB is authoritative and saved; API returns `fs_synced:false` + `fs_error` and the UI warns
  (mirrors the app's existing "DB saved, FS best-effort" pattern without claiming full success).
[COMPLETE] (backend unit-tested + frontend build-tested; live-FS verification pending DEV)
