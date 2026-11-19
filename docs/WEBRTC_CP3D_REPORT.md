# CP3-D Report — Phone Presence, PHONE_OFFLINE and Agent Lifecycle

Date: 2026-11-19 · FS-CC laptop repo, `main` @ `cc852e31` + uncommitted CP3-B/C/D changes. **Not committed, not pushed.**

**Not touched:**
- DEV, production, FS-CP and FS-ENRS.
- FreeSWITCH.
- `services/socketService.js` (diff is empty).
- Migration 014 (not run anywhere).

Design: `WEBRTC_CP3D_IMPLEMENTATION_PLAN.md`.

## 1. Files changed (CP3-D)
| File | Change |
|---|---|
| `backend/services/phonePresenceService.js` (new) | Per-agent phone state machine (`none/online/grace/offline`), 15 s grace, deferral during calls, startup recovery, permission changes, logout. `makeApplyPhoneOffline()` is the atomic PHONE_OFFLINE writer on the existing status path. Clock and timers are injectable. |
| `backend/services/sipRelayService.js` | One ordering fix: a replacing session is registered **before** the old one is closed, so a browser refresh is not seen as a lost phone |
| `backend/server.js` | Creates presence when the relay exists. Attaches relay events and ESL `agent:state`. Emits `agent:phone` and `agent:webrtc-changed` through the existing `getIO()` (no Socket.IO code change). Runs startup recovery after listen. Stops presence on shutdown. |
| `backend/controllers/agentDeskController.js` | `POST /status Available` → **409 `PHONE_OFFLINE`** while the phone is offline (allowed during the grace). `Logged Out` → presence logout and relay close. `/me` adds `phone_status`. |
| `backend/controllers/agentsController.js` | Admin change to browser-phone permission (flag, deactivate, contact/type) → `permissionChanged`. Supervisor-forced `Logged Out` → presence logout. |
| Tests (new) | `phonePresence.test.js` (31), `phoneOfflineAccounting.test.js` (4), `phonePresenceControllers.test.js` (12); one relay+presence integration test added to `sipRelay.test.js` |

**Database changes:** none. This uses the CP3-B migration 014 `PHONE_OFFLINE` break code and the existing `agents`, `agent_state_log` and `agent_state_events` tables.

## 2. State-transition design

| Event | Phone state | Agent status / break | Call |
|---|---|---|---|
| SIP registration succeeds through the relay | → `online` | unchanged | untouched |
| Relay socket closed, or phone signed out | `online` → `grace` (15 s) | unchanged | untouched |
| Disconnect again while already in grace | stays `grace`, **timer not restarted** | unchanged | untouched |
| Re-registered within 15 s | → `online` | unchanged (no record written) | untouched |
| Socket reconnects but doesn't register | stays `grace` | — | — |
| Grace expires, agent **Available**, not on a call | → `offline` | → **On Break / PHONE_OFFLINE** (atomic, only if still Available) | — |
| Grace expires, agent on a **queue call** (`Receiving` / `In a queue call`) | → `offline` | PHONE_OFFLINE **deferred** | **untouched** |
| …that call ends (ESL `agent:state`) | `offline` | → On Break / PHONE_OFFLINE (once) | — |
| Grace expires, agent already on another break, or Logged Out | → `offline` | **kept as is** (e.g. LUNCH stays LUNCH) | — |
| Phone recovers after offline | → `online` | **stays On Break**; the agent must choose Available | — |
| Agent chooses Available while phone `offline` | `offline` | refused, 409 | — |
| Agent / supervisor logs out | forgotten; relay session closed; tickets revoked | Logged Out | — |
| Browser refresh | stays `online` (new session replaces old; no grace) | unchanged | — |
| Browser tab closed | `grace` → `offline` | PHONE_OFFLINE if Available | — |
| Admin disables the browser phone | forgotten; `agent:webrtc-changed {allowed:false}` | unchanged, **no** PHONE_OFFLINE | relay closed now, or **after the call** |
| Agent disabled, gateway, inactive or EXTERNAL_PBX at grace expiry | forgotten | unchanged, no PHONE_OFFLINE | — |
| Backend restart | logged-in WebRTC agents get a 60 s startup grace; nothing restored; a new ticket is needed | PHONE_OFFLINE only if not re-registered in time and Available | — |
| Registration never succeeded (wrong password) | `none` | unchanged | — |

**No duplicate break records:**
- PHONE_OFFLINE is written through the existing `handleStatusTransition` before FreeSWITCH is told.
- FreeSWITCH's echoed codeless `On Break` is a same-status no-op (tested).
- A second PHONE_OFFLINE on an open PHONE_OFFLINE segment is a no-op (tested).
- The Available segment is closed and one coded break segment is opened, so break duration is accounted for by the existing writer (tested).

**Timestamps:**
- `agents.break_started_at = now()` (DB clock);
- `agent_state_events` start and end come from the existing writer;
- `agent_state_log.reason = 'phone_offline'`;
- `agent:phone` events carry `since`.

**Socket.IO events (new names, sent through the existing server):**
- `agent:phone {agentId, phone, since}` goes to the agent's room and to authenticated clients.
- `agent:webrtc-changed {agentId, allowed}` goes to the agent's room only.
- The existing `agent:status` is emitted with `break_code: 'PHONE_OFFLINE'`, so current screens update.

## 3. Tests (actual results)
| Run | Where | Result |
|---|---|---|
| Backend, full | Laptop | **46 files / 593 tests passed**. The relay+presence integration test was added afterwards: 38/38 in `sipRelay.test.js`. |
| Backend, full | Ubuntu-FS isolated copy | **46 / 594 passed** |
| Agent Desktop tests / typecheck / build | Ubuntu-FS copy | **15 / 200 passed**; exit 0; built |
| Admin frontend build | Ubuntu-FS copy | built (no test suite exists) |
| Backend syntax check, all files | Ubuntu-FS copy | 0 errors; presence and relay modules load on Node 22 |
| SIP.js 0.21.2 end-to-end through the relay (CP3-C check, rerun) | Ubuntu-FS copy | **14 / 14** |
| `git diff --check` | Laptop | clean |

Every timing test uses vitest fake timers; there are no real-time waits.

**Requested scenarios → tests:**
- 15 s grace (before/at expiry);
- disconnect/reconnect; repeated disconnects (no extension);
- active call during disconnect; recovery during an active call; ringing counts as a call;
- logout while disconnected; browser refresh (unit test and real relay); tab closed;
- backend restart (startup grace; nothing before 60 s);
- disabled agent (during grace; admin disable when idle and during a call); gateway; EXTERNAL_PBX;
- duplicate offline and duplicate recovery events; concurrent agent action wins;
- break-duration accounting through the existing writer;
- agent selecting PHONE_OFFLINE (400); Available while offline (409); ordinary break while offline allowed;
- availability after recovery (stays On Break).

## 4. Known limitations
1. **Only queue calls are seen as "on a call".** That comes from mod_callcenter `Receiving` / `In a queue call`.
   - A direct call the agent dials themselves (not through a queue) isn't visible to FS-CC after the phone drops.
   - If such a call is open when the grace expires, the agent is still moved Available → On Break.
   - That is a status flag only: the call itself is not touched, and mod_callcenter doesn't hang up on a status change.
   - Tracking non-queue calls would need FreeSWITCH channel-to-agent mapping. Not done (no speculative logic).
2. **Presence lives in memory on one backend instance**, the same as tickets and the relay.
3. **Startup recovery assumes** that logged-in agents allowed WebRTC were registered before the restart. An agent who never signed their phone in becomes `offline` after 60 s, and On Break if Available. This is intended, because an Available WebRTC agent without a phone can't take calls.
4. **Before the first registration**, an agent who is logged in but never signs the phone in stays `none`. They aren't blocked or put on break. CP3-E should prompt them to sign the phone in.
5. **Supervisor override:** forcing an agent Available is still allowed while their phone is offline. That's existing supervisor authority, left as it was.
6. **Not tested against a real FreeSWITCH or mod_callcenter** (CP8). The ESL `agent:state` values used are the ones the existing code and Live Agents already rely on.

## 5. CP3-E integration requirements (Agent Desktop)
- **Gate:** start the phone only if `/me.webrtc_allowed` (or login `agent.webrtc.allowed`) is true; otherwise render nothing phone-related.
- **Tickets:**
  - `POST /api/agent-desk/webrtc/ticket {kind:'connect'}` before the first connect;
  - `{kind:'reconnect'}` before **every** reconnect, because tickets are single use;
  - WS URL = page origin + base path + `relay_path` + `?ticket=`;
  - SIP domain = `sip_domain`.
- **Phone status:** show `phone_status` / `agent:phone` as a phone indicator **separate** from the status and break selector:
  - `grace` = "Reconnecting…";
  - `offline` = "Phone offline".
- **Recovery prompt:** after `offline` → `online`, show a prompt telling the agent the phone is back and they should set themselves Available. Never send Available automatically.
- **409 on Available:** when `POST /status Available` returns 409 `PHONE_OFFLINE`, show that message and keep the current status.
- **`agent:webrtc-changed`:**
  - `allowed:false` → show "browser phone will turn off after this call", then log the phone out and hide it once no call is active;
  - `allowed:true` → show the phone panel.
- **PHONE_OFFLINE is never in the break selector** (the backend already excludes it). The current break label shows "Phone offline" from `break_name`.
- **Logout:** `Logged Out` already closes the relay server-side; the desktop should also stop SIP.js.

## 6. Next step
CP3-E (Agent Desktop) is **not started**. It waits for your approval.
