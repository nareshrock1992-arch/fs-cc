# CP3-B Report — Telephony mode, per-agent permission, tickets

Date: 2026-11-19 · FS-CC laptop repo, `main` @ `cc852e31` + uncommitted changes. Not committed, not pushed. No package files or dependencies changed. FS-CP, FS-ENRS, DEV and production untouched.

## Changes
| File | Change | Reason |
|---|---|---|
| `backend/config/index.js` | `config.telephony` (`TELEPHONY_MODE` default `EXTERNAL_PBX`, `SIP_RELAY_UPSTREAM_URL`, `WEBRTC_TICKET_TTL_MS` 30000, `WEBRTC_GRACE_MS` 15000); `TELEPHONY_MODES`; `telephonyConfigErrors()`; `assertTelephonyConfig()` | Customer mode as deployment config (addendum Option A); fail-fast on invalid values |
| `backend/server.js` | Calls `assertTelephonyConfig()` at startup; `GET /api/telephony/config` (admin JWT) | Startup validation; admin UI needs the mode |
| `backend/utils/telephony.js` (new) | `parseInternalContact()`, `modeAllowsWebrtc()`, `effectiveWebrtc()` | Single place for the precedence rule |
| `backend/db/migrations/014_webrtc_phone_offline.sql` (new) | `agents.webrtc_enabled` (default false), constraint `agents_webrtc_internal_only`, `PHONE_OFFLINE` break code (`agent_selectable=false`) | Per-agent permission and system break |
| `backend/services/relayTicketStore.js` (new) | Single-use 256-bit tickets, 30 s TTL, ≤3 live per agent, `revokeAgent()`, `ticketHint()`; per-agent rate limiter | Replay protection, binding, invalidation, abuse limit |
| `backend/controllers/agentDeskController.js` | `agentWebrtcTicket()`; login returns `agent.webrtc.allowed`; `/me` returns `webrtc_allowed` (raw flag not exposed); `Logged Out` revokes tickets | Ticket issue, desktop gate, logout invalidation |
| `backend/routes/agentDesk.js` | `POST /webrtc/ticket` registered **only** when the mode allows WebRTC; rate limit 10/min/agent | No ticket route at all for EXTERNAL_PBX |
| `backend/controllers/agentsController.js` | `validateWebrtcSetting()`; create/update accept `webrtcEnabled`; switching to gateway forces it off; change is audit-logged (`AGENT_WEBRTC_CHANGED`); list includes `webrtc_enabled` | Admin per-agent setting, customer mode wins |
| `backend/controllers/breakCodesController.js` | `SYSTEM_BREAK_CODES`; PHONE_OFFLINE cannot be edited, deactivated or used as a rename target (403) | System break stays system-managed |
| `frontend/src/api/client.js`, `frontend/src/pages/Agents.jsx` | `Telephony.config()`; "Browser phone" checkbox shown only for internal agents when the mode allows it; pre-ticked for new agents in FREESWITCH_WEBRTC, unticked in HYBRID; not sent otherwise | Admin control |
| 4 new test files | see below | |

## Tests (actual results)
| Run | Result |
|---|---|
| Laptop: FS-CC backend `npx vitest run` | **41 files / 488 tests passed** (426 existing + 62 new) |
| Ubuntu-FS isolated copy `/root/test/fs-cc` (not DEV): backend | 41 / 488 passed |
| Same: agent-desktop tests | 15 / 200 passed (unchanged code) |
| Same: agent-desktop typecheck / build | exit 0 / built |
| Same: admin frontend build | built (no test suite exists, known TEST-1) |
| `git diff --check` | clean |

New tests: `telephonyRules.test.js` (rule + config, scenarios 1, 5, 6, 7, 15), `relayTicketStore.test.js` (8, 9, replay, expiry, cap, revoke, no full ticket in hints), `webrtcAgentDesk.test.js` (1, 4, 5, 6, 13, 16, logout revoke, /me and login fields), `webrtcAdminSettings.test.js` (2, 6, 14, audit, gateway switch).

## Outstanding / not verified
- **Migration 014 has not been run against a database.** It uses the existing idempotent patterns, but must be executed on an isolated test PostgreSQL (CP8) before any deployment.
- `agent:webrtc-changed` socket event and the safe "after the call" timing are CP3-D/E (design addendum §4).
- The Agent Desktop still uses the build-time flag and direct WSS; the runtime gate and relay URL are CP3-E. Until then, nothing in the desktop changes.
- No relay exists yet (CP3-C), so tickets are issued but not yet consumed by anything.
- **DEV impact at deployment:** DEV must get `TELEPHONY_MODE=HYBRID` and `SIP_RELAY_UPSTREAM_URL` in its env before the CP3 backend runs there, and the test agent must be ticked. A WebRTC mode without the URL makes the backend refuse to start (by design). Separate owner-approved step.
- FS-CP `deploy/.env.example` / compose need the new vars (CP4).

## Next proposed action
CP3-C — backend SIP relay with the `ws` package: dependency and security review first (version, advisories, licence), then `sipRelayService.js` (origin check, ticket consume, per-frame extension check, ping/timeout, frame-size and one-socket-per-agent limits) and tests with a fake upstream. Needs approval to add `ws` to `backend/package.json`.
