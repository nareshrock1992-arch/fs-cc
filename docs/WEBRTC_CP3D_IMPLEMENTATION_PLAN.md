# CP3-D Implementation Plan — Phone Presence and PHONE_OFFLINE

Approved 2026-11-19. Laptop FS-CC repo only. No DB schema change: this uses migration 014's PHONE_OFFLINE row (still not run anywhere). Socket.IO code is unchanged; events go out through its existing `getIO()`.

## New module: `backend/services/phonePresenceService.js`
- In-memory, per agent: `phone` (`none | online | grace | offline`), `since`, grace timer, `pendingOffline`, `pendingClose`.
- Clock and timers are injectable, so the tests use controlled clocks.

**Inputs**
| Source | Event | Effect |
|---|---|---|
| Relay (CP3-C) | `registered` | Phone `online`; cancel the grace timer and any pending offline. The agent's status is **not** changed (recovery never sets Available). |
| Relay | `session-close`, `unregistered` | `online` → `grace`, with a 15 s timer. Already in `grace`: the timer is **not** restarted, so flapping can't postpone the offline state forever. Ignored if a newer relay session exists for the agent (refresh or replacement). |
| Relay | `session-open` | Recorded only. A socket alone isn't recovery: SIP registration is required. |
| ESL `ccEvents` | `agent:state` | When the agent leaves a call state (`Receiving`, `In a queue call`), apply a pending PHONE_OFFLINE or a pending disable close |
| Agent desk | status `Logged Out` | Cancel timers, forget presence, close the relay session (`relay.closeAgent`) |
| Admin | `webrtc_enabled` changed | `false` → `agent:webrtc-changed {allowed:false}`; close the relay now, or after the queue call ends; no PHONE_OFFLINE. `true` → emit `{allowed:true}` |
| Startup | `startupRecovery()` | Agents allowed WebRTC whose status is `Available` or `On Break` get a 60 s startup grace. Without a re-registration by then, they go `offline`. Nothing is restored from memory, and every reconnection needs a new ticket. |

## Grace expiry → `evaluate(agentId)`
1. Reload the agent. If `effectiveWebrtc` no longer allows it (disabled, gateway, inactive, EXTERNAL_PBX), clear presence. **No PHONE_OFFLINE.**
2. Phone becomes `offline`; emit `agent:phone`.
3. If status ≠ `Available` (another break, or Logged Out), the agent's status is left unchanged.
4. If the mod_callcenter state is `Receiving` or `In a queue call`, set `pendingOffline` and **leave the call alone**.
5. Otherwise apply PHONE_OFFLINE.

## Applying PHONE_OFFLINE (no duplicates, no conflicts)
1. `UPDATE agents SET status='On Break', break_code='PHONE_OFFLINE', break_started_at=now() WHERE agent_id=$1 AND status='Available' RETURNING …`. This is an atomic compare-and-set, so a concurrent agent action wins and nothing is applied twice.
2. `agent_state_log` row, `reason='phone_offline'`.
3. `handleStatusTransition(agentId,'On Break','phone_offline',{break_code:'PHONE_OFFLINE', break_name})`. This is the existing session/event writer, with its advisory lock. Break duration accounting is unchanged.
4. Only **after** the DB write: `cc.agentSetStatus(agentId,'On Break')`. When FreeSWITCH echoes `agent-status-change On Break` (no code), the existing writer treats it as a same-status no-op, so the PHONE_OFFLINE segment is kept and not duplicated.
5. `ccEvents.emit('agent:status', …)` so the existing Socket.IO broadcast updates every screen.

## Agent desk changes
- `POST /status Available` is refused with **409 `PHONE_OFFLINE`** while the phone is `offline`. During `grace` it is allowed, because that is a temporary interruption.
- `PHONE_OFFLINE` remains non-selectable (CP3-B).
- `GET /me` adds `phone_status`.
- `Logged Out` triggers the presence logout.

## Admin changes
`updateAgent`: after a `webrtc_enabled` change, `presence.permissionChanged(agentId, allowed)`. The admin "set status Logged Out" path also triggers the presence logout.

## Active calls
The service never hangs up, transfers or touches a call, and never writes to `calls` / `agent_history`. Phone state and call state are tracked separately.

## Out of scope
Agent Desktop UI and the ticket and relay client (CP3-E).
