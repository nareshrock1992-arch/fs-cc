# CP3-A — WebRTC Relay and PHONE_OFFLINE Audit (read-only)

Date: 2026-11-19 · Repo: FS-CC laptop source · Branch `main` · HEAD `cc852e31` · working tree clean, in sync with `origin/main`.
Nothing was changed except creating this file. No DEV/production access, no tests that write data, no commits.

---

## 1. Current implementation inventory

| Area | Status | Where |
|---|---|---|
| SIP.js engine (register, calls, transfer, DTMF, audio devices) | **Implemented** | `agent-desktop/src/features/softphone/engine/src/**` (`sip/sip-client.ts`, `sip/call-session.ts`, `services/phone-service.ts`) |
| Browser → FreeSWITCH WSS, **direct** | **Implemented** (current path) | `sip-client.ts:49-52` `transportOptions.server = creds.wssUrl`, `keepAliveInterval: 30` |
| WSS URL / SIP domain from build config, no host fallback | Implemented | `adapters/configAdapter.js` `buildAppConfig()` (`VITE_SIP_DOMAIN`, `VITE_SIP_WSS_URL`) |
| Feature flag | Implemented (**build-time only**, global) | `configAdapter.js` `isWebrtcEnabled()` → `VITE_WEBRTC_ENABLED === 'true'` |
| Extension derived from internal contact, gateway agents refused | Implemented (**client-side only**) | `configAdapter.js` `parseInternalContact()`, `getSoftphoneEligibility()` |
| Registration renewal 300 s | Implemented | `configAdapter.js` `registerExpires: 300` |
| SIP password: typed by agent, kept in memory only | Implemented | `usePhone.js` `login(password)` → `buildCredentials()` → engine; not stored or sent to backend |
| Engine transport reconnect (back-off up to 30 s) | Implemented | `engine/src/services/reconnect.ts` |
| Retry after non-auth REGISTER failure (15 s) | Implemented | `phone-service.ts:238-244` |
| Phone indicator on the desk (display only) | Implemented | `adapters/agentStateAdapter.js` `describePhoneIndicator()` |
| **Relay ticket** | **Stub only** | `adapters/authAdapter.js` `resolveWssUrl()` returns the configured URL; called from `usePhone.js:30` |
| **Backend SIP WebSocket relay** | **Missing** | No WebSocket server besides Socket.IO; no `ws` dependency in `backend/package.json` |
| **Single-use / reconnect tickets** | **Missing** | — |
| **Server-side extension ownership check** | **Missing** | Only the browser checks eligibility today |
| **15 s connection-loss grace** | **Missing** | The only 15 s timer is the REGISTER retry above; it is not a loss grace |
| **PHONE_OFFLINE system break** | **Missing** | Only the comment in `agentStateAdapter.js:5` |
| **Per-agent `webrtc_enabled`** | **Missing** | No column; the flag is global at build time |
| **Relay ping / health monitoring** | **Missing** | — |

Note: the earlier Phase 1 audit is still accurate on these points. The only correction is about the "15 s loss grace", which is not implemented.

## 2. Relevant existing backend code (must be reused, not duplicated)

| Item | File / function | Behaviour |
|---|---|---|
| Agent login | `backend/controllers/agentDeskController.js` `agentLogin()` | PIN check (bcrypt), `startLoginSession()`, JWT `{agentId, fullName, role:'agent'}` 12 h. Response includes `contact` (no secrets). |
| Agent auth middleware | `backend/middleware/auth.js` `requireAgentAuth()` | Bearer JWT, `role === 'agent'` → `req.agentId` |
| Admin API isolation | `auth.js` `requireAuth()` | Rejects agent tokens (403) |
| Login rate limit | `backend/middleware/loginLimiter.js` `createLoginLimiter()` | Used on `/api/agent-desk/login` |
| Status change | `agentDeskController.js` `agentSetStatus()` | Valid: `Available`, `On Break`, `Logged Out`. `break_code` accepted only if `active AND agent_selectable`. Writes `agents`, `agent_state_log (reason 'agent_self')`, ESL `cc.agentSetStatus`, `handleStatusTransition()` |
| State history | `backend/services/agentSessionService.js` `handleStatusTransition()` | Advisory lock per agent, one `agent_state_events` row per segment, new row when the break code changes |
| FreeSWITCH status events | `backend/services/eslService.js` ~L850 `agent-status-change` | Writes the DB, logs `reason 'fs_event'`, calls `handleStatusTransition(..., 'fs_event')` with **no break code**, emits `agent:status` |
| Socket.IO | `backend/services/socketService.js` `initSocket()` | CORS `config.cors.origin`; `agent:authenticate` (JWT) → room `agent:<id>`; broadcast `agent:status`, `agent:state`, `agent:offering`, `agent:no-answer`, `call:*`, `channel:*`, `esl:status`; `client:deauthenticate` on logout |
| Break codes | migration `007` `break_codes` table (`agent_selectable`, `active`), seeded COFFEE/LUNCH/MEETING/TRAINING/OTHER | |
| Agent type | migration `005` `agents.agent_type` (`internal`/`gateway`), contacts normalised to `{sip_cid_type=pid}user/<ext>@<domain>` | Extension ownership source |
| Queue auto-break | migration `008` `queues.agent_no_answer_status` (default `On Break`) | Existing no-answer behaviour |

## 3. Implemented vs missing — summary
- **Implemented:** the browser phone, a direct WSS connection, client-side eligibility, 300 s registration renewal, an in-memory password, transport reconnect and the indicator.
- **Missing:** the relay, tickets, the server-side extension check, the 15 s grace, `PHONE_OFFLINE`, per-agent enablement and relay health.
- **Gap that matters for security:** today any signed-in agent could type *any* extension and password into the browser phone. FreeSWITCH alone decides. There is no binding between the FS-CC agent and the SIP extension. The relay closes this gap.

## 4. Proposed architecture

```
Browser (SIP.js) ──WSS /api/sip-relay?ticket=…──► FS-CC backend relay ──WSS──► FreeSWITCH :7443 (internal profile)
      │                                                │
      └── REST /api/agent-desk/webrtc/ticket (JWT) ────┘  (ticket bound to agentId + extension)
```

**Backend (new)**
- `backend/services/sipRelayService.js`: attaches a `ws` WebSocket server to the existing HTTP server through `upgrade` on path `/api/sip-relay`. It does this:
  1. Checks the `Origin` header against `config.cors.origin`.
  2. Consumes the ticket.
  3. Opens an upstream WSS to `SIP_RELAY_UPSTREAM_URL` (env), with subprotocol `sip`.
  4. Pipes frames both ways without changing them.
  5. Inspects only REGISTER/INVITE `From`/`To` user parts and rejects any frame whose SIP user ≠ the ticket's extension (403-style close).
  6. Sends a WebSocket ping every 20 s and closes when no pong arrives within 10 s.
  7. Reports connect/disconnect to the phone-presence service.
- `backend/services/relayTicketStore.js`: an in-memory `Map`, ticket → `{agentId, extension, kind, exp}`.
  - Tickets are 32 random bytes (`crypto.randomBytes`) in base64url.
  - TTL is 30 s. A ticket is deleted on first use, which makes replay impossible.
  - A sweep runs every 30 s, and each agent can hold at most 3 live tickets.
  - Single-node note: a multi-instance deployment would need Redis. Not needed now.
- `backend/services/phonePresenceService.js`: per-agent relay state, the 15 s grace timer and the `PHONE_OFFLINE` transition (§8).
- `backend/controllers/agentDeskController.js` gets a new `agentWebrtcTicket()` (route below).
- `backend/config/index.js` gets new settings:
  - `webrtc.relayUpstreamUrl` (`SIP_RELAY_UPSTREAM_URL`);
  - `webrtc.graceMs` (default 15000);
  - `webrtc.ticketTtlMs` (default 30000).
  - Nothing is hardcoded.
- `backend/server.js` calls `initSipRelay(server)` next to `initSocket()`.
- `backend/package.json` adds the dependency `ws`. This is new and needs approval.

**Frontend**
- `adapters/authAdapter.js`: `resolveWssUrl()` POSTs `/api/agent-desk/webrtc/ticket` with the agent JWT and returns `<relay base>?ticket=…`. When `VITE_SIP_RELAY=false`, it keeps the current direct URL as a rollback path.
- `engine/.../reconnect.ts` / `sip-client.ts`: before each reconnect, request a fresh `kind:'reconnect'` ticket, because every ticket works only once. This needs a small hook, `getServerUrl()`, that the engine calls on each reconnect.
- `adapters/agentStateAdapter.js` and `workspace/phone/PhoneParts.jsx`: show a **"Phone offline"** indicator that is separate from the break label. When the phone recovers, show a prompt saying the phone is back and asking the agent to set themselves Available. The prompt never sets the status itself.
- The SIP password stays in browser memory and travels **inside SIP REGISTER digest auth only**. The backend relay sees only the digest response, never the clear password.

## 5. Proposed API and socket changes (all additive)

| Change | Kind | Notes |
|---|---|---|
| `POST /api/agent-desk/webrtc/ticket` body `{kind:'connect'|'reconnect'}` → `{ticket, expires_in, relay_path, extension}` | New REST endpoint (`requireAgentAuth`, rate-limited 10/min/agent) | Refused when the agent is not `internal`, `webrtc_enabled` is false, or the contact can't be parsed. |
| `GET /api/agent-desk/me` adds `webrtc_enabled`, `phone_status` | Additive fields | Old clients ignore them. |
| WS upgrade `/api/sip-relay?ticket=` | New | Subprotocol `sip`. |
| Socket.IO `agent:phone` `{agentId, phone:'online'|'offline'|'grace'}` | New event, sent to room `agent:<id>` and supervisors | Existing events unchanged. |
| nginx | `/cc/api/sip-relay` needs `Upgrade`/`Connection` headers | FS-CP CP4 task, not FS-CC. |

## 6. Database changes (need approval)
- A new migration `014_webrtc_phone_offline.sql`, idempotent and additive:
  1. `ALTER TABLE agents ADD COLUMN IF NOT EXISTS webrtc_enabled BOOLEAN NOT NULL DEFAULT false`. This is required by "defaults to false for internal agents". There is no existing column to reuse.
  2. `INSERT INTO break_codes (code,name,description,display_order,agent_selectable,created_by) VALUES ('PHONE_OFFLINE','Phone offline','System: browser phone unavailable',900,false,'system_seed') ON CONFLICT DO NOTHING`.
     - Because `agent_selectable=false`, agents can't choose it, and `agentSetStatus()` already rejects it.
- **No extension column.** Extension ownership comes from `agents.contact` plus `agent_type='internal'`, using the same regex as `configAdapter.js`. The regex moves to a shared backend util `backend/utils/agentContact.js`.
- Admin UI: `frontend/src/pages/Agents.jsx` gets a "Browser phone" toggle, shown only for internal agents. `agentsController.js` create/update accept `webrtc_enabled` and reject it for gateway agents.

## 7. Security risks and mitigations

| Risk | Mitigation |
|---|---|
| Ticket replay | Single use: deleted on first lookup; 30 s TTL; 256-bit random |
| Ticket theft through logs or URL | Never log the ticket, log only `ticket#<first 4 chars>`. The query string is unavoidable for a browser WS, so it is short-lived and single-use. nginx `access_log` for the relay path must strip the query (CP4). |
| Agent registers someone else's extension | Ticket bound to the extension from the DB. The relay checks the REGISTER/INVITE user part on every frame and closes on mismatch. |
| Gateway agent uses WebRTC | The ticket endpoint refuses `agent_type != 'internal'` and `webrtc_enabled=false` |
| Cross-site WebSocket hijack | `Origin` checked against `config.cors.origin` before the upgrade; ticket also required |
| Abuse or flooding | Ticket endpoint 10/min/agent; at most 3 live tickets and 1 active relay socket per agent (a new connection closes the old one); max frame size 64 KB |
| SIP password exposure | Never sent to the FS-CC REST API. Relay frames are not logged (debug logging prints only the SIP method and status code). |
| Stale session after logout | `Logged Out` / `client:deauthenticate` closes the agent's relay socket and cancels tickets and grace timers. JWT expiry (12 h) is checked when a ticket is issued. |
| Reconnect abuse | Reconnect ticket needs a still-valid JWT; same rate limit |
| Upstream FreeSWITCH TLS | Upstream URL from env; TLS verified by default, `SIP_RELAY_UPSTREAM_INSECURE=true` allowed only for lab self-signed certificates |
| `JWT_SECRET` default | Already fail-fast in `config/index.js:102` |

## 8. PHONE_OFFLINE state-transition design

States per agent in `phonePresenceService`: `none` → `online` → `grace` → `offline`.

1. **Relay connected and REGISTER 200 OK** → `online`. Emit `agent:phone online`. No agent status change.
2. **Relay socket closes or pings fail** while the agent status is `Available` or `On Break` → `grace`. A 15 s timer starts. Emit `agent:phone grace`.
3. **Reconnect within 15 s** → back to `online`. Nothing is recorded.
4. **Grace expires:**
   - If the agent is `Available`: call the existing path `cc.agentSetStatus(agentId,'On Break')`, then update the DB and `handleStatusTransition(agentId,'On Break','phone_offline',{break_code:'PHONE_OFFLINE',break_name:'Phone offline'})`. Log `agent_state_log` with reason `phone_offline`. Emit `agent:status` and `agent:phone offline`.
   - If the agent is already `On Break` (for example LUNCH): keep their break code. Only mark the phone `offline`. Their chosen break is not overwritten.
   - If the agent is on a call: wait until the call ends, then re-evaluate. mod_callcenter handles the call leg itself.
5. **Phone recovers:** set phone to `online` and emit. The agent **stays On Break (PHONE_OFFLINE)** until they choose Available themselves, as the brief requires.
6. **Logout:** clear everything; no PHONE_OFFLINE.
7. **Backend restart:** presence is in memory, so after a restart every relay reconnects with new tickets within the grace. No offline state is applied at startup.

**Reporting.** PHONE_OFFLINE time is an `On Break` segment with `break_code='PHONE_OFFLINE'` in `agent_state_events`:
- it counts in existing break totals;
- it can be filtered and split by code in break-history reports, which already filter by `break_code`.

Owner decision needed: should PHONE_OFFLINE count in "break totals" or be shown separately on dashboards? The default is to count it, as a separate code.

**Interaction with FS events.** mod_callcenter later sends `agent-status-change On Break` through `eslService` with no code. `handleStatusTransition` treats the same status in the same session as a no-op when no new code is given, so the PHONE_OFFLINE segment is kept. A test must confirm this.

## 9. Test plan

**New backend unit tests** in `backend/src/__tests__/unit/`, using mocked DB and ESL, with no persistent data:
- `relayTicketStore.test.js`: issue, single use, expiry, replay refused, per-agent cap, ticket value never in log output.
- `webrtcTicket.test.js`: endpoint refuses gateway agents, `webrtc_enabled=false`, a bad contact and a missing JWT; it returns the extension from the contact.
- `sipRelay.test.js`: a fake upstream WS server.
  - Origin rejected.
  - Bad or used ticket rejected.
  - REGISTER for another extension closes the socket.
  - Frames pass through unchanged.
  - Ping timeout closes the socket.
  - Logout closes the socket.
- `phonePresence.test.js`, using fake timers:
  - Reconnect in under 15 s means no status change.
  - More than 15 s while Available leads to On Break PHONE_OFFLINE.
  - Existing LUNCH break kept.
  - Recovery doesn't set Available.
  - On-call deferral.
  - Logout clears state.
- `agentDeskBreak.test.js` (extend): PHONE_OFFLINE can't be chosen through `/status`.
- `agentContact.test.js` (extend): the shared parser gives the same results as the frontend.

**New agent-desktop tests:** `authAdapter` ticket fetch, direct-URL fallback when the relay is off, a reconnect fetches a new ticket, the offline indicator is separate from the break label, and the recovery prompt.

**Regression tests that must stay green:**
- all 426 backend tests and all 200 agent-desktop tests;
- in particular `agentLoginCaseInsensitive`, `agentDeskBreak`, `agentHistoryReporting`, `agentReportController`, `agentRingTimeout`, `queueXmlGeneration`, `forceHangup`, `securityHardening`, `shell.test`, `phone.react.test` and `softphonePanel.test`.

**Manual checks in CP8, on a test environment only:**
- normal PIN login with WebRTC off;
- a gateway agent with an unchanged flow;
- queue login and logout;
- Available ↔ break;
- an inbound queue call to a WebRTC agent and to a desk phone;
- an outbound call;
- supervisor live views;
- pulling the network for under 15 s and for over 15 s;
- the reports showing PHONE_OFFLINE.

## 10. Ordered implementation plan (each step stops for approval)
- **CP3-B — Backend foundation.**
  - Migration `014`.
  - Shared `utils/agentContact.js`.
  - Config keys.
  - `relayTicketStore.js`.
  - The ticket endpoint.
  - `agentsController` / `Agents.jsx` `webrtc_enabled` toggle.
  - Unit tests.
- **CP3-C — Relay.**
  - Add the `ws` dependency.
  - `sipRelayService.js` (origin check, ticket check, extension check, ping, limits).
  - `server.js` wiring.
  - Unit tests with a fake upstream.
- **CP3-D — Phone presence and PHONE_OFFLINE.**
  - `phonePresenceService.js`.
  - Hooks into the relay and logout.
  - `agent:phone` socket event.
  - `/me` fields.
  - Tests.
- **CP3-E — Agent Desktop.**
  - `authAdapter` ticket flow.
  - Engine reconnect gets a new ticket.
  - Offline indicator and recovery prompt.
  - `VITE_SIP_RELAY` switch.
  - Tests, typecheck and build.
- **CP3-F — Integration and documentation.**
  - Full regression run.
  - `docs/` update (env vars, nginx upgrade note for FS-CP CP4).
  - Report.
  - Commit only after approval.

## 11. Risks, dependencies, rollback
- **Dependencies:**
  - FS-CP CP4 must add WebSocket upgrade headers and strip the query from the access log for the relay path.
  - CP5 must give the backend container network access to FreeSWITCH WSS on 7443 and a certificate the relay trusts.
- **New npm dependency `ws`:** widely used and needs approval. The alternative is none: Socket.IO can't carry raw SIP.
- **Latency/load:** the relay carries SIP signalling only, so the load is small. **Audio (RTP/SRTP) still goes browser ↔ FreeSWITCH directly**, which means the CP5 RTP firewall rules are still required.
- **Single backend instance:** tickets and presence are in memory and are lost on restart. Phones reconnect within the grace, so the effect is acceptable.
- **mod_callcenter behaviour:** if FreeSWITCH itself marks a WebRTC agent unreachable (`agent-no-answer`), the existing queue `agent_no_answer_status` still applies. PHONE_OFFLINE adds to it and doesn't replace it.
- **Rollback options:**
  1. Set `VITE_SIP_RELAY=false`. Phones go back to direct WSS, which is today's behaviour.
  2. Set `webrtc_enabled=false` per agent.
  3. Migration 014 is additive. The column and the break code can stay unused, so no down-migration is needed.
  4. Reverting the CP3 commits restores the current behaviour completely.

## Owner decisions needed before CP3-B
1. Approve migration `014` (the `webrtc_enabled` column and the `PHONE_OFFLINE` break code).
2. Approve the new backend dependency `ws`.
3. Choose whether PHONE_OFFLINE counts in break totals (default: yes, as its own code).
4. Approve the 30 s ticket lifetime and the limit of 10 tickets per minute per agent.
