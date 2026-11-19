# CP3-E Report — Agent Desktop Integration (Relay, Presence, Telephony Workspace)

Date: 2026-11-19 · FS-CC laptop repo, `main` @ `cc852e31` + uncommitted CP3-B…E changes. **Not committed, not pushed.**

**Not touched:**
- DEV, production, FS-CP and FS-ENRS.
- FreeSWITCH.
- `services/socketService.js` (diff is empty).
- Queue, routing and reporting logic.
- Migration 014 (not run anywhere).

Plan: `WEBRTC_CP3E_IMPLEMENTATION_PLAN.md` (checkpoint 1 audit included). Screenshots: `docs/webrtc-cp3e-evidence/`.

## 1. Integration architecture (as built)

```
Agent Desktop (browser)                                      FS-CC backend                        FreeSWITCH
──────────────────────                                      ─────────────                        ──────────
/me → webrtc_allowed (mode + switch + internal + active) ──► server decides
  └ false: no phone code loaded, no ticket, no relay, no phone UI (EXTERNAL_PBX, gateway, not enabled)
  └ true : lazy-load sip.js chunk
      agent types SIP password (memory only)
      POST /agent-desk/webrtc/ticket {connect} ─────────────► single-use 30 s ticket (+extension, sip_domain)
      SIP.js ── wss://<page origin>/<api base>/sip-relay?ticket=… ──► relay (CP3-C) ── ws/wss "sip" ──► :5066/:7443
      on every reconnect: POST …/ticket {reconnect} → NEW URL on the SAME UserAgent (calls survive)
      Socket.IO agent:phone / agent:webrtc-changed ◄────────── presence (CP3-D)
      pagehide → POST …/webrtc/page-reload (keepalive) ─────► one-time 60 s refresh allowance
Audio: browser ⇄ FreeSWITCH RTP directly (unchanged)
```

- **Single phone status:** `features/softphone/presence.js` combines the engine state with the server's `phone_status`. The top-bar pill, console header, health badge, dial reason, the Available block and the break panel all use it.
- **Separate from agent status:** the agent status (Available / On Break · reason / Logged Out) stays its own control.

## 2. Changed files

**Agent Desktop: relay and lifecycle**

| File | Change |
|---|---|
| `features/softphone/engine/src/types/phone.ts` | `Credentials.ticketProvider`; `TicketError` (fatal / temporary) |
| `features/softphone/engine/src/sip/sip-client.ts` | `reconnect(url)` sets SIP.js 0.21.2 `transport.configuration.server` on the **same** UserAgent; SIP.js log lines redacted |
| `features/softphone/engine/src/services/phone-service.ts` | Every reconnect gets a new ticket. A fatal refusal stops retries; with no call the phone signs out, during a call it is **not** cut. Ticket redacted in `state.account`, errors and logs. **Bug fix:** logout now clears `account` / `call` / `consult` / `conference` (the merge-based store previously kept the old account visible after sign-out). |
| `features/softphone/engine/src/utils/validation.ts` | `redactUrl()` |
| `features/softphone/adapters/authAdapter.js` | Rewritten: `relayUrlFor`, `requestTicket`, `createTicketProvider`, error mapping (401/403/404 fatal, 429 temporary) |
| `features/softphone/adapters/configAdapter.js` | The server decides eligibility (`webrtc_allowed`); gateway always refused. **No `VITE_SIP_DOMAIN` / `VITE_SIP_WSS_URL`**, so the direct FreeSWITCH path is removed. `VITE_WEBRTC_ENABLED=false` remains as a kill switch. Credentials are built from the ticket. |
| `features/softphone/PhoneProvider.jsx`, `usePhone.js` | No engine unless allowed. Login = ticket → relay URL → engine; `fetchTicket` and `apiBase` injectable for tests |
| `features/softphone/presence.js` (new) | Phone presence reducer, Available block reason, recovery prompt rule |
| `api/client.js` | Errors carry `status` / `code`; `webrtcTicket()`; `notifyPageReload()` (keepalive, same JWT header); `apiBase()` |
| `pages/Dashboard.jsx` | Loads the phone only when the server allows it. Tracks `agent:phone` and `agent:webrtc-changed`. `pagehide` sends the reload notice. `/me` patch includes `webrtc_allowed` and `wrap_up_time`. |

**Agent Desktop: UI**

| File | Change |
|---|---|
| `shell/PhoneConnectionStatus.jsx` (new) | Phone pill in the top bar, separate from agent status. Hidden for desk-phone agents. Icon only at phone width. |
| `workspace/phone/IncomingCallNotification.jsx` (new) | Incoming call on pages without the console: `role=alertdialog`, focus on Answer, Escape does not reject |
| `workspace/phone/CallControls.jsx` (new) | Mute, Hold/Resume, Transfer, Conference, extracted from PhoneConsole (real engine actions only) |
| `workspace/WrapUpPanel.jsx` (new) | Wrap-up from real mod_callcenter state (Available + Idle after a call), countdown from `wrap_up_time`; no disposition (no backend exists) |
| `workspace/phone/PhoneNotices.jsx` (new) | "Phone is back — set Available when ready" (never automatic); "supervisor turned the phone off" |
| `workspace/Desk.jsx` | Wires presence. Console only for browser-phone agents. "Not reachable" only when signed out / failed / offline (not during a short reconnect). Switch-off: console kept until the call ends, then phone logout. |
| `workspace/phone/PhoneConsole.jsx` | Uses CallControls; header and dial reason from the shared presence |
| `shell/StatusSelector.jsx` | Available disabled with the reason while the phone can't take calls; label shorter at phone width |
| `components/CurrentBreakPanel.jsx` | "Return to Available" disabled with the reason while the phone is offline |
| `shell/AppShell.jsx` | Phone status slot next to the status selector |
| `shell/ConnectionLamps.jsx` | Health label hidden below 640 px (dot and screen-reader text kept) |
| `workspace/CallStrip.jsx` | `hideRingActions`, so Answer/Reject are not duplicated with the notification |
| `ui/primitives.jsx` | `Button` forwards refs (focus on Answer); behaviour otherwise unchanged |

**Backend (small, additive)**

| File | Change |
|---|---|
| `services/phonePresenceService.js` | `expectReload()`: a one-time 60 s grace for the next phone loss, at most once per 5 min, also applied when the phone is unregistered on unload, and extends a running grace once |
| `controllers/agentDeskController.js`, `routes/agentDesk.js` | `POST /agent-desk/webrtc/page-reload` (agent JWT, 5/min, WebRTC modes only); `/me` adds `wrap_up_time` |

**Tests (new or updated)**
- New: `authAdapter.test.js`, `presence.test.js`, `relay-reconnect.test.ts`, `cp3eDesk.test.js`.
- Updated to the new rules (the server decides; the ticket gives extension and domain): `configAdapter.test.js`, `phone.react.test.js`, `softphonePanel.test.js`.
- Backend: page-reload tests in `phonePresence.test.js` and `phonePresenceControllers.test.js`.

**Database:** no change beyond migration 014 (CP3-B).

## 3. Test results (actual)

| Run | Where | Result |
|---|---|---|
| Backend, full | Laptop and Ubuntu-FS isolated copy | **46 files / 600 tests passed** |
| Agent Desktop, full (incl. engine) | Ubuntu-FS isolated copy | **19 files / 268 tests passed** (was 200) |
| Agent Desktop typecheck (`tsc`) | Ubuntu-FS copy | exit 0 |
| Agent Desktop production build | Ubuntu-FS copy | built; sip.js only in a lazy chunk (`usePhone-*.js`), entry bundle has no SIP.js |
| Admin frontend build | Ubuntu-FS copy | built (no test suite exists) |
| **SIP.js 0.21.2 end-to-end through the relay** | Ubuntu-FS copy, Node 22 | **19 / 19** (14 from CP3-C + 5 new: drop, spent ticket refused, **same UserAgent reconnects with a new ticket**, re-registration) |
| Bundle and source security scan | Ubuntu-FS copy | No `:7443` or build-time WSS URL in the bundle. Browser storage writes: agent token, agent info and theme only (existing); **no ticket, no SIP password** |
| `git diff --check` | Laptop | clean |

All timing tests use fake timers.

**Requested scenarios → evidence**

| Scenario | Test |
|---|---|
| SIP.js registration | e2e (digest challenge round-trip); `phone.react.test` (ticket first, server extension/domain) |
| Incoming call | `cp3eDesk` (notification, focus, Answer/Reject → engine); `phoneConsole.test` / `workspace.test` (existing) |
| Outgoing call | `phoneConsole.test` (dial, cancel; existing) |
| Hold/resume, mute/unmute | `cp3eDesk` (CallControls → engine); `phoneConsole.test` |
| Transfer, conference | `phoneConsole.test` (blind, consult, swap, complete, merge; existing); `transfer.test.ts` |
| Disconnect/reconnect | `relay-reconnect.test.ts` (new ticket each time, back-off, online event); e2e on real SIP.js |
| Browser refresh | backend page-reload tests (60 s allowance, extend running grace, no permanent bypass, once per 5 min, unregister on unload); relay replacement (CP3-D) |
| Agent logout | existing logout path + server closes the relay (CP3-D tests) |
| Admin disabling the phone | `cp3eDesk` (during a call: controls kept, phone off after the call; idle: off at once); `relay-reconnect` (fatal refusal) |
| EXTERNAL_PBX | `cp3eDesk` (nothing phone-related); `phone.react` (no engine, no ticket request) |
| HYBRID / FREESWITCH_WEBRTC | `cp3eDesk` (pill + console for allowed agents) |
| Gateway agent rejected | `configAdapter`, `phone.react` (never eligible, no ticket); `cp3eDesk` |
| PHONE_OFFLINE | `cp3eDesk` (Available and Return-to-Available blocked with reason; not in the break list; recovery prompt; no auto-Available); `presence.test` |
| Active call during connectivity loss | `relay-reconnect` (fatal during a call does not cut it); CP3-D backend tests |

## 4. UI evidence (`docs/webrtc-cp3e-evidence/`)
Rendered from the **real Desk components** with a fake phone object, in the isolated test copy (temporary preview page, not in the repo).
1. `01-external-pbx-desk-phone-agent.jpg`: no phone pill, dial pad or warnings.
2. `02-phone-ready.jpg`: "Phone ready" pill beside the agent status "Available".
3. `03-incoming-call-other-page.jpg`: notification with Answer/Reject on the Queues page; call bar without duplicate buttons.
4. `04-active-queue-call.jpg`: timer, End call, Mute/Hold/Transfer/Conference, customer panel.
5. `05-reconnecting-grace.jpg`: "Phone reconnecting…" everywhere; no "Not reachable" alarm.
6. `06-phone-offline-phone_offline-break.jpg`: PHONE_OFFLINE break; Return to Available disabled with the reason.
7. `07-status-menu-available-blocked.jpg`: Available disabled with the reason; PHONE_OFFLINE not offered.
8. `08-phone-recovered-prompt.jpg`: "Your browser phone is back… Set Available" (agent's choice).
9. `09-wrap-up.jpg`: wrap-up countdown.
10. `10-supervisor-switched-off-during-call.jpg`: notice; call controls kept until the call ends.
11. `11-active-call-dark-mode.jpg`.
12. `12-active-call-phone-width.jpg`: no horizontal overflow at 390 px (also checked at 768 and 1024 px).

Issues found **by** the visual review and fixed in this checkpoint:
- console header disagreed with the top bar while reconnecting;
- "Not reachable" alarm during a short reconnect;
- "Return to Available" was still active while the phone was offline;
- the console disappeared during a call after a supervisor switch-off;
- header overflow at phone width.

## 5. Security checks
| Requirement | Result |
|---|---|
| Relay tickets not in browser storage | Verified (source and production bundle): tickets live only in memory until the WebSocket opens |
| SIP password not in browser storage | Verified; memory only (unchanged design) |
| No credentials in browser logs | SIP.js log lines, engine errors and `state.account` are redacted (`ticket=***`); tested |
| No direct FreeSWITCH WSS in the integrated path | No `VITE_SIP_WSS_URL` / `VITE_SIP_DOMAIN` use; bundle contains no `:7443`; test asserts the relay URL |
| Unauthorized agents cannot start a phone | No engine and no ticket request unless the server allows; the server refuses tickets anyway (CP3-B/C) |
| Gateway agents excluded | Client never eligible; server refuses (CP3-B) |
| Logout ends the phone session | Desk logs the phone out, then `Logged Out`; the server closes the relay and revokes tickets (CP3-D) |
| Spent tickets can't be reused | Each reconnect fetches a new ticket; spent-ticket reconnect refused (e2e on real SIP.js) |
| Pre-existing, unchanged | The agent JWT and agent info are in `localStorage`, as before CP3 (existing design, out of scope) |

## 6. Known limitations
1. **Refresh needs the SIP password again**, because it isn't stored by design. The one-time 60 s allowance covers a normal refresh. Browsers can't tell a refresh from a tab close on `pagehide`, so **closing the tab takes 60 s (not 15 s) to become PHONE_OFFLINE**, at most once per 5 minutes.
2. **No disposition codes** (no backend API). Wrap-up is a read-only countdown from mod_callcenter state; wrap-up is only recognised after this desktop saw the queue call.
3. **Engine standalone helper:** the vendored engine's own `loadConfig()` (standalone use) still reads `VITE_SIP_*`. FS-CC never calls it and it isn't in the FS-CC path.
4. **Dev without HTTPS:** the engine still requires `wss://`. A plain-HTTP desk page (ws://) can't use the browser phone, which is unchanged and intended. Production is behind nginx HTTPS.
5. **Not tested against a real FreeSWITCH or real audio.** Calls, media, conference rooms and transfers with real endpoints are covered by engine unit tests and the SIP.js signalling e2e only. They need CP8.
6. **Ubuntu-FS leftover:** the temporary built preview folder `/root/test/gallery-dist` remains. A delete command was blocked by the safety check; the other preview files were removed by the next sync. It's harmless test output and can be deleted when convenient.

## 7. CP8 requirements (integration on an isolated test environment)
- Test backend with migration 014 applied to an isolated database. Env:
  - `TELEPHONY_MODE` = HYBRID and also FREESWITCH_WEBRTC;
  - `SIP_RELAY_UPSTREAM_URL`;
  - `SIP_RELAY_CA_FILE` if needed;
  - `FS_SIP_DOMAIN` (the ticket returns it; required);
  - `CORS_ORIGIN` = the exact desk origin.
- nginx: WebSocket upgrade for `/cc/api/sip-relay`, the access log without the query string, and `/cc/api/agent-desk/webrtc/page-reload` reachable (FS-CP CP4).
- A test FreeSWITCH, or an owner-approved test extension, plus RTP firewall rules (CP5). Backend IP allowlisted in any fail2ban.
- Manual run:
  - sign in; inbound queue call (answer, reject, timeout); outbound call;
  - hold/resume, mute, DTMF; blind and consult transfer; 3-way conference;
  - pull the network for <15 s and >15 s; refresh; close the tab;
  - supervisor switch-off during a call and when idle;
  - EXTERNAL_PBX regression with Avaya/gateway agents;
  - reports show PHONE_OFFLINE.
- Verify DEV readiness separately: DEV needs `TELEPHONY_MODE` and the agent switch before its browser phone works again (owner-approved step).

## 8. Next step
CP3-E is complete here and **stopped**. Nothing is committed or deployed. CP8 is not started.
