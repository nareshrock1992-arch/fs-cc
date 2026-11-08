# FS-WebRTC → FS-CC Agent Desktop — Phase 2 Implementation Plan

**Date:** 2026-11-07. Read-only preparation. **No code has been changed. Phase 2 has not started.**

**Sources:**
- `fs-webrtc` @ `23ab1ce`
- `fs-cc` @ `f560dd7`
- [WEBRTC_AGENT_DESKTOP_FEASIBILITY_AUDIT.md](WEBRTC_AGENT_DESKTOP_FEASIBILITY_AUDIT.md) (roadmap §20.1, decisions §22.00)
- [WEBRTC_PHASE_2_READINESS.md](WEBRTC_PHASE_2_READINESS.md)

**Phase 2 scope, per roadmap §20.1:**
- An isolated React feature module that holds a copy of the engine.
- A `PhoneProvider` and a `usePhone()` hook.
- A lazy-loaded chunk.
- A lockfile.
- A TypeScript build under Vite 6.

**Not in Phase 2:**
- The `webrtc_enabled` migration and admin UI (Phase 3).
- The SIP relay and tickets (Phase 4).
- The `PHONE_OFFLINE` and Available safeguards (Phase 5).
- The call UI wired into Dashboard events (Phase 6).

The fixed architecture decisions in the brief are not reopened here.

---

## 1. Current architecture findings

### 1.1 FS-WebRTC engine (reference implementation, stays unchanged)

| Area | Files (`C:\Users\naresh\Documents\fs-webrtc\`) | Notes |
|---|---|---|
| Facade | `src/services/phone-service.ts` (485 lines) | `PhoneService`: one call at a time, devices, reconnect, user-facing errors |
| SIP | `src/sip/sip-client.ts` (127), `src/sip/call-session.ts` (98) | Wraps SIP.js `UserAgent` and `Registerer`; `expires = config.registerExpires`; WSS keep-alive every 30 s; 10 s connection timeout |
| State | `src/services/store.ts`, `src/services/call-state.ts`, `src/types/phone.ts` | Framework-free observable `Store<PhoneState>`; pure call reducer |
| Reconnect | `src/services/reconnect.ts` | Back-off from 2 s, doubling, capped at 30 s, plus up to 20% jitter |
| Audio | `src/audio/devices.ts`, `remote-audio.ts`, `ringtone.ts` | Microphone permission, `setSinkId` speaker choice, ringtone, and the "Enable audio" unlock |
| Config | `src/config/config.ts` | `registerExpires: 300`, `iceServers: []`, `VITE_SIP_DOMAIN`, `VITE_SIP_WSS_URL`; no secrets |
| Utilities | `src/utils/logger.ts`, `time.ts`, `validation.ts` | — |
| Vanilla UI (not reused) | `src/main.ts`, `src/pages/*`, `src/components/*`, `src/styles/app.css` | DOM UI for the proof of concept |
| Proxy (Phase 4 reference) | `server/server.mjs`, `server/sip-via.mjs` | WSS → WS proxy that rewrites `Via` |
| Tests | `tests/unit/{call-state,logger-time-store,reconnect,sip-via,validation}.test.ts` | vitest 5.1.0 with jsdom |
| Dependencies | `sip.js 0.21.2`, `ws 8.22.1` (server only); TypeScript 6, Vite 8 | — |

**Engine API (`PhoneService`):**
- **State:** `store` (with `get`/`subscribe`) and `initialPhoneState()`.
- **Account:** `validateCredentials(creds)`, `login(creds)` and `logout()`.
- **Calls:** `dial(input)`, `answer()`, `reject()`, `hangup()`, `toggleMute()`, `toggleHold()` and `sendDtmf(tone)`.
- **Audio:** `refreshDevices()`, `selectInput(id)`, `selectOutput(id)` and `unlockAudio()`.
- **Messages:** `clearError()`.

`Credentials` is `{extension, password, domain, wssUrl, displayName?}`. `PhoneState` contains no password.

**Engine behaviours that matter for integration (verified in the code):**
- **E-1. Password lifetime.** The password lives only in the private field `creds`. It is cleared in `teardownClient()` and never logged.
- **E-2. Global listeners.** The `PhoneService` constructor adds `window` listeners for `online`, `offline` and `pagehide`, plus a device-change listener. **There is no `dispose()`.** Creating more than one instance would leak listeners, and React `StrictMode` (used in `agent-desktop/src/main.jsx`) mounts effects twice.
- **E-3. Fixed address on reconnect.** Reconnect calls `UserAgent.reconnect()` with the **same** `wssUrl` given at `login()`. A single-use ticket in the URL therefore cannot be refreshed without an engine hook. Decision Q15 already plans that small hook. Whether SIP.js 0.21.2 allows changing the transport `server` after construction is **UNKNOWN**; check it in Phase 4.
- **E-4. Wrong password.** On 401, 403 or 407 the engine logs out and never retries. Other failures retry after 15 s.
- **E-5. Address from the user.** `wssUrl` is part of `Credentials`, which came from the login form in the POC. In FS-CC it must come from configuration, never from what the agent types.

### 1.2 FS-CC Agent Desktop

| Area | Files (`C:\Users\naresh\Documents\fs-cc\agent-desktop\`) | Findings |
|---|---|---|
| Build | `package.json`, `vite.config.js` | React 18.3, Vite ^6.0.5, plain **JavaScript/JSX**: no TypeScript, no `tsconfig`, **no tests, no lint, no lockfile** |
| Entry | `src/main.jsx`, `src/App.jsx` | `StrictMode`; `App` shows `Login` or `Dashboard`; no router |
| Auth | `src/hooks/useAgentAuth.js` | JWT and agent info kept in `localStorage` (`agent_token`, `agent_info`); expiry checked every 60 s |
| API | `src/api/client.js` | `fetch` with a Bearer token; endpoints `/agent-desk/login`, `/me`, `/status`, `/queues`, `/calls`, `/performance`, `/esl-status`, `/break-codes`, `/break-history`, `/call-history` |
| Realtime | `src/api/socket.js` | One Socket.IO client; `agent:authenticate` joins the room `agent:{id}` |
| Dashboard | `src/pages/Dashboard.jsx` (424 lines) | Socket events: `agent:offering`, `call:bridged`, `call:bridge-end`, `channel:hangup`, `agent:no-answer`, `agent:status`, `agent:state`, `call:enqueued`, `call:abandoned`, `esl:status`; logout sets `Logged Out` |
| Status | `src/components/StatusControls.jsx`, `CurrentBreakPanel.jsx` | Available, On Break (with a code) and Logged Out |
| Dev proxy | `vite.config.js` | Only `/api` and `/socket.io`; **no `/sip`** |
| Production | `nginx.conf`, `nginx.prod.conf`, `Dockerfile` | `/api/`, `/socket.io/` and the SPA; **no `/sip` location** (Phase 4) |
| Installed packages | `node_modules` | Installed on Linux; the Windows build is blocked (see the readiness report) |

### 1.3 FS-CC backend (relevant facts for later phases)

- **Routes:** `backend/routes/agentDesk.js`, handled by `backend/controllers/agentDeskController.js`.
- **Login token:** `agentLogin` signs `{agentId, fullName, role:'agent'}` for 12 h. The login response returns `agent_id`, `full_name`, `avaya_extension`, `contact`, `status` and `state`, but **no `agent_type` and no WebRTC field**.
- **Break codes on `/status`:** `agentSetStatus` accepts a `break_code` only if it is `active AND agent_selectable` (`agentDeskController.js` lines 118–130). **`PHONE_OFFLINE` must therefore be a non-selectable system code set by a server-side path, not by this endpoint.** That is Phase 5.
- **Agent type:** `agent_type` exists (migrations `005`, `008`).
- **Latest migration:** `011`. Phase 3 adds `012`.
- **Tests:** 32 vitest unit files, 396 passing (baseline).

---

## 2. Integration requirements

- **R-1.** Copy the engine (`src/services`, `src/sip`, `src/audio`, `src/types`, `src/utils`, `src/config`) with **behaviour unchanged**. Record the source commit (`23ab1ce`) in a `SOURCE.md` file.
- **R-2.** Create exactly **one** `PhoneService` per page as a lazy module-level singleton. React mounts must never construct it (this answers E-2 and StrictMode).
- **R-3.** The extension, domain and transport address come from FS-CC (configuration now, `/me` in Phase 3). The agent types **only the password**, which answers E-5.
- **R-4.** The softphone is off by default. It is gated by the build flag `VITE_WEBRTC_ENABLED` (Phase 2) and later by the per-agent flag. When off, no softphone code is loaded and `sip.js` is never downloaded.
- **R-5.** No existing Agent Desktop behaviour changes when the flag is off.

## 3. Proposed module structure

```
agent-desktop/src/features/softphone/
  SOURCE.md                    # engine provenance: fs-webrtc@23ab1ce, files copied, local diffs (none in Phase 2)
  engine/                      # copied verbatim from fs-webrtc/src (TypeScript)
    services/ sip/ audio/ types/ utils/ config/
  adapters/
    configAdapter.js           # builds AppConfig + non-secret Credentials parts from FS-CC config/agent
    authAdapter.js             # Phase 4: fetch relay ticket with the agent JWT (stub in Phase 2)
    agentStateAdapter.js       # Phase 5: phone state -> desk indicators (no status writes in Phase 2)
  PhoneProvider.jsx            # React context; subscribes to the singleton's Store
  usePhone.js                  # hook: { state, login(password), logout, answer, reject, hangup, ... }
  phoneSingleton.js            # lazy getPhoneService(); one instance per page
  ui/
    SoftphonePanel.jsx         # minimal password entry + status (Phase 2: hidden behind flag)
  index.js                     # public surface: PhoneProvider, usePhone, SoftphonePanel (lazy)
  __tests__/                   # engine tests copied + adapter/hook tests
```

**Public surface:** only `index.js`. Nothing outside `features/softphone/` imports from `engine/`.

## 4. Minimum code changes by step (Phase 2 only)

| Step | Change | Files |
|---|---|---|
| 2.1 | Add a lockfile from the **current** dependency set, before any new dependency, so the existing state is reproducible. Run `npm install` on Linux/WSL and commit `package-lock.json` alone | `agent-desktop/package-lock.json` |
| 2.2 | Verify the baseline `vite build` succeeds (blocked on Windows today) | none |
| 2.3 | Add the runtime dependency `sip.js` pinned to exactly `0.21.2`. Add dev dependencies `typescript`, `vitest` and `jsdom`, with versions chosen to match Vite 6 (**UNKNOWN until checked**: fs-webrtc uses Vite 8 and vitest 5.1.0, which may need Vite ≥ 7) | `package.json`, lockfile |
| 2.4 | Add a `tsconfig.json` that covers `src/features/softphone/engine/**` only (`noEmit`, strict). Add the scripts `typecheck` and `test`. Vite 6 compiles `.ts` through esbuild **without type-checking**, so `tsc --noEmit` is the type gate | `tsconfig.json`, `package.json` scripts |
| 2.5 | Copy the engine verbatim and write `SOURCE.md`. Required local change: **none**. `import.meta.env` and `vite-env.d.ts` work under Vite 6 (**to verify in 2.4**) | `features/softphone/engine/**` |
| 2.6 | Add `phoneSingleton.js` and `configAdapter.js`. Config comes from `VITE_SIP_DOMAIN` and `VITE_SIP_WSS_URL` (non-secret). The extension comes from the agent's `contact`, parsed `user/<ext>@domain` (decision Q14); a gateway contact gives "not eligible" | adapters |
| 2.7 | Add `PhoneProvider.jsx` and `usePhone.js`, using `useSyncExternalStore` on `store.subscribe`. The provider never calls `logout` on unmount (StrictMode); it calls it on desk logout | provider and hook |
| 2.8 | Add a lazy `SoftphonePanel` behind `VITE_WEBRTC_ENABLED === 'true'`. In `Dashboard.jsx`: one `React.lazy` import and one conditional render. Call `phone.logout()` inside the existing `handleLogout` before `api.setStatus('Logged Out')`, only when the feature is loaded | `ui/SoftphonePanel.jsx`, `pages/Dashboard.jsx` (gated lines only) |
| 2.9 | Tests (§10) and a build check that, with the flag off, the main bundle contains no `sip.js` | `__tests__/**` |

**Transport in Phase 2.** The FS-CC relay does not exist until Phase 4, so Phase 2 registration can only be exercised in the **lab**. It points `VITE_SIP_WSS_URL` at the existing lab FS-WebRTC proxy (`wss://<lab>:8443/sip`) with the lab users 7990001 and 7990002. Production builds keep the flag off.

**Not changed in Phase 2:** the backend, database, FreeSWITCH, FS-ENRS, `nginx*.conf` and `src/api/*`.

## 5. Dependencies

| Item | Decision |
|---|---|
| React 18, Vite 6, Tailwind, lucide-react, socket.io-client | Reuse |
| `sip.js` | **New**, pinned `0.21.2`, the same version as the verified POC |
| `ws` | Not needed in the browser; it returns in the backend relay (Phase 4) |
| `typescript`, `vitest`, `jsdom` | **New dev dependencies**; versions UNKNOWN until checked against Vite 6 (step 2.3) |
| fs-webrtc eslint and prettier setup | Not imported (agent-desktop has no lint); can be added later |

## 6. Authentication and SIP credential flow

1. **FS-CC login (unchanged).** The agent logs in with `agent_id` and PIN and receives a JWT, stored in `localStorage` as today.
2. **Eligibility.**
   - Phase 2: the build flag, plus a `user/` contact.
   - Phase 3: `/me.webrtc.enabled`, the admin flag (default false), plus the extension derived server-side.
3. **Password.** The agent types the SIP password into the `SoftphonePanel` password field. It is passed straight to `PhoneService.login({extension, password, domain, wssUrl})`. It goes into no React state other than the uncontrolled input, which is cleared after submit. It is not saved to `localStorage` or `sessionStorage`, not logged, not sent over Socket.IO and not sent to the FS-CC API.
4. **Digest authentication.** SIP.js answers FreeSWITCH's challenge, so the password itself never travels on the wire.
5. **Phase 4.** `authAdapter.getTicket()` makes an authenticated `POST` and gets a single-use ticket. The URL becomes `wss://<desk-origin>/sip?ticket=…`. The relay pins `From` to the agent's extension. A small engine hook (E-3) calls `getTicket()` before every reconnect.
6. **Teardown.** Desk logout, JWT expiry or page hide calls `phone.logout()`, which un-registers and clears the password.

## 7. Call-state and agent-state synchronisation

- **Phase 2:** read only. `usePhone()` exposes `connection`, `registration` and `call`. The desk shows a phone indicator but **makes no status writes** driven by phone state.
- **Phase 5:**
  - After a 15 s grace window, a confirmed registration loss produces a server-side On Break with `PHONE_OFFLINE`. The server path is needed because the code is not agent-selectable.
  - Recovery never sets Available.
  - Choosing Available needs a registration check through ESL.
- **Phase 6:** map `agent:offering` and `call:bridged` to the SIP `Invitation` (match by caller and timing, **UNKNOWN**; lab check), plus the incoming banner and answer controls.
- **Single source of truth:** mod_callcenter status stays authoritative. The engine's state is only an input.

## 8. Security risks and mitigations

| Risk | Mitigation |
|---|---|
| Password persisted or leaked | Uncontrolled input; no storage; ESLint and grep check in CI for `localStorage` or `sessionStorage` inside `features/softphone`; a test asserts the store state never holds the password |
| Agent edits the server address | `wssUrl` comes only from config or the relay; there is no UI field |
| Agent registers another extension | Phase 2: the extension is derived, not typed. Phase 4: the relay pins `From` and checks ownership with the ticket |
| Listener leaks or duplicate user agents under StrictMode | Module singleton (R-2) |
| JWT in `localStorage` (existing) | Unchanged; relevant to Phase 4 tickets, which are single-use and short-lived |
| Unauthenticated Socket.IO broadcast (SEC-1, existing) | Phase 7 |
| Direct registration bypassing the relay | Lab check L-08 and Phase 7 |
| Lab password for users 7990001/7990002 (value intentionally not recorded) | Never committed or put in fixtures; tests use dummy values |

## 9. Backward-compatibility safeguards

- The feature is off by default. With the flag off, `Dashboard.jsx` renders exactly as today and `sip.js` stays out of the main chunk (checked by a bundle check).
- There are no backend, API, database, FreeSWITCH, nginx or FS-ENRS changes in Phase 2.
- Avaya, Cisco, gateway and desk-phone agents are unaffected. A gateway `contact` makes the panel show "not eligible".
- The existing status flows (`StatusControls`, breaks, logout) are unchanged. The only added line in logout is guarded.

## 10. Test plan

**Unit (new vitest in agent-desktop):**
- The copied engine tests (5 files) pass unchanged.
- `configAdapter`:
  - `user/1001@dom` gives `1001`.
  - The `{sip_cid_type=pid,leg_timeout=20}user/1001@dom` form gives `1001`.
  - `sofia/gateway/...` gives not eligible.
  - An empty or malformed contact gives not eligible.
- `phoneSingleton` returns the same instance on repeated calls.
- `usePhone` re-renders on store change and unsubscribes on unmount.
- The password is absent from `store.get()`, from `localStorage` and from `sessionStorage` after login, and is not passed to `log()`.

**Integration (lab only; no lab access in this task):**
- With the flag on, register 7990001 through the lab proxy and receive a test call.
- Desk logout un-registers the phone.
- Lab checks L-01, L-06 and L-07.

**Regression:**
- Backend `npx vitest run` stays at 396 passing.
- `agent-desktop` `vite build` passes both with the flag off and with it on.
- Manual: login, status changes, breaks, call history and queue cards, with the flag off.
- The main bundle has no `sip.js` with the flag off.

## 11. Rollback

- **Runtime:** set `VITE_WEBRTC_ENABLED=false` and rebuild. This needs no data changes.
- **Code:** revert the Phase 2 commits. They touch only `agent-desktop/` (the feature folder, `package.json`, lockfile, `tsconfig.json`, and the gated lines in `Dashboard.jsx`), so a revert is clean.
- **Data:** nothing to roll back, because there is no database or FreeSWITCH change.

## 12. Unresolved questions and lab-dependent items

| ID | Item | Status |
|---|---|---|
| U-1 | Which `vitest`/`jsdom`/`typescript` versions are compatible with Vite 6 | UNKNOWN; resolve in step 2.3 |
| U-2 | Whether the engine compiles unchanged under Vite 6 with esbuild | UNKNOWN; resolve in step 2.4 |
| U-3 | Whether SIP.js 0.21.2 can change the transport URL before `reconnect()` (ticket hook) | UNKNOWN; Phase 4 |
| U-4 | How to match `agent:offering` to a SIP `Invitation` | UNKNOWN; Phase 6 lab |
| U-5 | Where `VITE_SIP_DOMAIN` comes from: `FS_SIP_DOMAIN` in the backend `.env` versus a build value | Decide in Phase 2 (build value) and move to `/me` in Phase 3 |
| U-6 | Linux/WSL build host for `npm install` and the lockfile (Windows build blocked) | Needed before step 2.1 |
| Lab | L-01 to L-16 from the readiness report | Outstanding |

## 13. Phase 2 checkpoints and acceptance criteria

| CP | Checkpoint | Acceptance |
|---|---|---|
| CP-1 | Lockfile for the existing dependencies; baseline build | `package-lock.json` committed alone; `vite build` passes on a clean `npm ci` |
| CP-2 | Dependencies and tooling | `sip.js@0.21.2` exact; `tsc --noEmit` passes on the engine; `npm test` runs |
| CP-3 | Engine copied | Files byte-identical to `fs-webrtc@23ab1ce` (hash list in `SOURCE.md`); 5 engine test files pass |
| CP-4 | Adapters, singleton, provider, hook | Unit tests from §10 pass; no password in storage or logs |
| CP-5 | Gated panel | Flag off: UI identical and no `sip.js` in the main chunk. Flag on: the panel lazy-loads |
| CP-6 | Lab smoke (optional in Phase 2) | 7990001 registers and receives a call through the lab proxy; desk logout un-registers |
| CP-7 | Regression and review | Backend 396/396; build passes; diff limited to `agent-desktop/`; owner review before merge |

## Recommendation

**READY FOR PHASE 2 IMPLEMENTATION**

The scope is fully contained in `agent-desktop/`, and every unknown above can be settled inside Phase 2 or is deferred to its owning phase. One condition applies: steps 2.1 and 2.2 must run on Linux/WSL, or after an approved Windows reinstall, because the current `node_modules` cannot build on Windows.

## Files changed by this task

- `C:\Users\naresh\Documents\fs-cc\docs\enterprise\WEBRTC_PHASE_2_IMPLEMENTATION_PLAN.md` (new, uncommitted). No other file was changed.
