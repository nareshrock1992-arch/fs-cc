# CP3-C Report — Secure SIP WebSocket Relay

Date: 2026-11-19 · FS-CC laptop repo, `main` @ `cc852e31` + uncommitted CP3-B/CP3-C changes. **Not committed, not pushed.**

**Not touched:**
- DEV, production, FS-CP and FS-ENRS.
- FreeSWITCH configuration.
- Socket.IO (`services/socketService.js` unchanged).
- Migration 014 (not run anywhere).

Related documents: `WEBRTC_CP3C_SECURITY_REVIEW.md` (dependency review and risks R1–R12) and `WEBRTC_CP3C_IMPLEMENTATION_PLAN.md` (design).

## 1. Changed files (CP3-C)
| File | Change |
|---|---|
| `backend/package.json`, `backend/package-lock.json` | `"ws": "~8.21.0"`. The lockfile adds only the top-level declaration and resolves to the existing 8.21.0; no version changes. |
| `backend/services/sipRelayService.js` (new) | The relay: upgrade checks, ticket consumption, agent re-authorisation, one upstream per browser, one session per agent, frame validation, rate limits, auth-failure limit, heartbeat, events, graceful shutdown, `initSipRelay()` (nothing attached for EXTERNAL_PBX) |
| `backend/services/sipFrame.js` (new) | Strict read-only SIP frame inspection: start line, mandatory headers, compact forms, percent-decoding, From/To/digest-username binding. Never rewrites. |
| `backend/config/index.js` | `SIP_RELAY_CA_FILE`, `SIP_RELAY_TLS_INSECURE` (refused in production), `SIP_RELAY_MAX_CONNECTIONS`, validated at startup |
| `backend/server.js` | `initSipRelay()` after `initSocket()`; on shutdown the relay closes before `server.close()` |
| `backend/src/__tests__/helpers/sipMessages.js` (new) | Test SIP message builder |
| `backend/src/__tests__/unit/sipFrame.test.js` (new) | 21 tests |
| `backend/src/__tests__/unit/sipRelay.test.js` (new) | 37 tests, using real `ws` servers on 127.0.0.1 |
| `docs/WEBRTC_CP3C_*.md` | Review, plan, this report |

CP3-B files from the previous checkpoint are still present and uncommitted (see `WEBRTC_CP3B_REPORT.md`).

## 2. Security controls

| Requirement | How |
|---|---|
| Server-side ticket validation, single use, expiry, replay | `ticketStore.consume()` before the handshake; unknown/used/expired → HTTP 401 |
| Agent ↔ extension binding | Ticket holds the extension. After the handshake the agent is reloaded from the DB and `effectiveWebrtc()` must allow it **and** give the same extension, otherwise close 4403. |
| Inactive / disabled / gateway agents; TELEPHONY_MODE | Same re-check on every new connection. For EXTERNAL_PBX the relay is never attached (tested: zero upgrade listeners). |
| Agent-supplied identity not trusted | Identity comes only from the ticket and the DB. Each browser frame is checked: `From` (dialog-creating requests), `To` (REGISTER), digest `username` (any Authorization header), and in-dialog ownership. Violations are not forwarded; the socket closes 4403. |
| Message types and payloads | Text only (binary → 1003). Must be valid SIP or a CRLF keep-alive (otherwise 4400). Allowed methods only. Headers ≤ 16 KiB. Frames ≤ 64 KiB (→ 1009). Folded headers refused. |
| Cross-agent isolation | One upstream per browser socket (never shared). One session per agent (the newer replaces the older, 4409). Upstream replies go only to their own browser. |
| Rate limits | 20 upgrades/min per IP (429); global cap (default 500, 503); 30 frames/s per connection, burst 60 (1008); ticket endpoint 10/min per agent (CP3-B); 5 SIP sign-in failures per 5 min per agent → 4429 and block (protects the shared backend IP at FreeSWITCH) |
| Origin / subprotocol | `Origin` must be in `CORS_ORIGIN` (403). The `sip` subprotocol is required from the browser (400) and from FreeSWITCH (otherwise 4504). |
| Heartbeat | Ping both legs every 20 s; terminate when no pong arrives in 10 s. When either leg closes, the other closes. |
| Graceful shutdown | Stop accepting (503), close browsers with 1001 and upstreams, terminate stragglers after 5 s, then the HTTP server closes |
| Secrets | SIP passwords never reach the relay (digest is end-to-end). Frames, SDP, Authorization headers and tickets are never logged (`ticket#xxxx` only). Tested. |
| TLS to FreeSWITCH | Certificate verification on by default; optional CA file; insecure mode refused in production |

## 3. Tests executed (actual results)

| Run | Where | Result |
|---|---|---|
| Backend, full suite | Laptop | **43 files / 546 tests passed** (426 original + 62 CP3-B + 58 CP3-C) |
| Backend, full suite | Ubuntu-FS isolated copy `/root/test/fs-cc` | 43 / 545 passed (run before the Socket.IO coexistence test was added; that test then passed on the laptop) |
| Agent Desktop tests (regression; no desktop code changed) | Ubuntu-FS copy | **15 / 200 passed** |
| Agent Desktop typecheck / build | Ubuntu-FS copy | exit 0 / built |
| Admin frontend build | Ubuntu-FS copy | built |
| Backend "type check and build" | Ubuntu-FS copy | The backend is plain JavaScript with no TypeScript or build step. Instead: `node --check` on every backend file → 0 errors; relay module loads under Node 22.22.1 |
| Lockfile reproducibility | Ubuntu-FS throwaway dir | `npm ci --omit=dev` → `ws@8.21.0` (top level + Socket.IO, deduped) |
| **SIP.js end-to-end compatibility** | Ubuntu-FS copy, Node 22 | **14 / 14 checks passed** (below) |
| `git diff --check` | Laptop | clean |

**Relay test coverage (all requested scenarios):**
- valid ticket; invalid ticket; expired ticket; reused ticket;
- gateway agent; browser phone disabled; inactive agent; agent disabled or extension changed after ticket issue;
- EXTERNAL_PBX (not attached, and refused); HYBRID and FREESWITCH_WEBRTC acceptance;
- incorrect extension (From, To, digest username, INVITE, SUBSCRIBE); unauthorised forwarding;
- cross-agent isolation (separate upstreams, no traffic crossing, same-agent replacement);
- oversized payload; non-SIP text; binary frames;
- frame rate, upgrade rate, connection cap, sign-in failure limit (other agents unaffected), the normal first 401 not counted;
- browser disconnect and reconnect with a new ticket; FreeSWITCH disconnect; FreeSWITCH unreachable;
- browser heartbeat timeout; queued frames delivered in order; graceful shutdown;
- events; no ticket in logs;
- Socket.IO on the same server: relay sessions survive engine.io's 1 s timer, and the `/socket.io/` WebSocket still upgrades.

**SIP compatibility evidence.** The real **SIP.js 0.21.2** `UserAgent` and `Registerer` (taken from the agent-desktop install) were connected through the relay to a fake FreeSWITCH that performs real MD5 digest authentication. That fake runs in the test only; no real FreeSWITCH was involved.

| Check | Result |
|---|---|
| Connects; both legs negotiate `sip` | PASS |
| REGISTER → 401 challenge → digest REGISTER → 200 OK (Registered); exactly 2 REGISTERs | PASS |
| Digest verified by the server; the password appears in neither relay logs nor frames | PASS |
| CRLF keep-alive (RFC 7118 §6) both directions | PASS |
| FreeSWITCH-initiated request (OPTIONS) parsed and answered by SIP.js through the relay | PASS |
| Un-REGISTER (expires 0) | PASS |
| `registered` / `unregistered` relay events | PASS |
| SIP.js stop closes the relay session | PASS |
| Wrong SIP password: the rejection reaches SIP.js unchanged | PASS |
| SIP.js with a reused ticket cannot connect | PASS |

## 4. Known limitations
1. **Not yet tested against a real FreeSWITCH.**
   - The check used a fake FreeSWITCH plus real SIP.js. That covers SIP.js framing and digest flow, but not FreeSWITCH's own handling of WS clients behind one source IP: NAT/`received` (R2), and calls ringing the right agent.
   - Testing against the real one requires an isolated FreeSWITCH or an approved test extension (CP8). DEV FreeSWITCH was **not** used.
2. **No audio test.** Media is not relayed by design. INVITE/SDP pass-through is verified at the frame level (byte-exact), but a real call with audio must be tested in CP8.
3. **One backend instance only.** Tickets, sessions and rate counters are in memory. Scaling out would need a shared store and sticky sessions.
4. **Re-authorisation happens only at connect time.** Disabling an agent doesn't drop a live session; that "after the call" logic is CP3-D (`relay.closeAgent()` is ready for it).
5. **The engine.io 1 s timer** for unknown upgrades still applies. It is harmless because the relay writes the 101 handshake at once; covered by a test.
6. **The Agent Desktop still connects directly to FreeSWITCH.** It doesn't use tickets or the relay yet (CP3-E).
7. **The 9 existing `npm audit` findings** (Express and Socket.IO dependencies, morgan, modesl) are unchanged; this is separate item SEC-DEP-1.

## 5. Deployment prerequisites (for the later DEV/customer rollout, each needs owner approval)
- **Backend env:**
  - `TELEPHONY_MODE=HYBRID` or `FREESWITCH_WEBRTC`;
  - `SIP_RELAY_UPSTREAM_URL`, either `wss://<freeswitch-host>:7443` or `ws://<freeswitch-host>:5066` on a private segment only;
  - `SIP_RELAY_CA_FILE` if `wss` uses a private CA (mkcert in the lab).
- **Migration 014** applied to that environment's database (run first on an isolated test DB).
- **nginx (FS-CP CP4):** add `/cc/api/sip-relay` with WebSocket upgrade headers, `proxy_read_timeout` above 40 s, `X-Real-IP` set, and **no query string in the access log** for that location.
- **Network:** the backend can reach the FreeSWITCH WS/WSS port; browsers reach FreeSWITCH RTP ports directly (CP5).
- **FreeSWITCH / fail2ban:** allowlist the backend address so one agent's failures can't ban everyone. No FreeSWITCH config change is otherwise needed.
- `CORS_ORIGIN` must contain the exact Agent Desktop origin.

## 6. Next steps (not started)
- **CP3-D:** phone presence from the relay events. The 15 s grace runs on `session-close` without re-registration, then PHONE_OFFLINE is applied using the existing status path. Recovery doesn't set the agent Available. `agent:phone` and `agent:webrtc-changed` Socket.IO events. "Disable after the call" through `relay.closeAgent()`.
- **CP3-E:** Agent Desktop runtime gate (`webrtc_allowed`), ticket fetch, relay URL from the page origin, a fresh ticket on every reconnect, and a phone status indicator separate from the agent state.
