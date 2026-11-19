# CP3-C Implementation Plan — Secure SIP WebSocket Relay

Approved 2026-11-19 (owner). Scope: `ws` dependency, relay, ticket integration, restrictions, isolation, limits, heartbeat and shutdown. Socket.IO, FreeSWITCH config and RTP are unchanged.

## Dependency
- `backend/package.json`: `"ws": "~8.21.0"`.
- The lockfile resolves to **8.21.0**, the same copy Socket.IO already uses (deduped). `npm install ws@~8.21.0` first picked 8.21.3. That was rejected, because it would also have changed Socket.IO's copy and hadn't been reviewed. The lockfile was restored and pinned to 8.21.0. No other package version changed.

## Files
| File | Purpose |
|---|---|
| `backend/services/sipRelayService.js` (new) | Relay: upgrade handling, ticket/agent checks, 1:1 upstream, SIP frame validation, limits, heartbeat, events, shutdown |
| `backend/services/sipFrame.js` (new) | Small, strict parser for SIP-over-WebSocket frames (request/status line, From/To/Authorization user), with no rewriting |
| `backend/config/index.js` | `SIP_RELAY_CA_FILE`, `SIP_RELAY_TLS_INSECURE` (refused in production), `SIP_RELAY_MAX_CONNECTIONS` |
| `backend/server.js` | `initSipRelay(server)` only when the mode allows WebRTC; relay closes first on shutdown |
| tests | `sipFrame.test.js`, `sipRelay.test.js` (real `ws` servers on random ports: fake browser and fake FreeSWITCH) |
| isolated E2E | Real SIP.js 0.21.2 `UserAgent` + `Registerer` (from the agent-desktop install) in Node 22 → relay → fake FreeSWITCH with digest auth, on Ubuntu-FS `/root/test` |

## Connection flow
1. **HTTP upgrade on `/api/sip-relay`.** Other paths are ignored, so Socket.IO's own upgrade handling is untouched. These checks run **synchronously before the 101 handshake**, with no database wait. Failures get a plain HTTP error and the socket is closed:
   - relay accepting (not shutting down);
   - global connection cap;
   - per-IP upgrade rate (20/min);
   - `Origin` ∈ `CORS_ORIGIN`;
   - `Sec-WebSocket-Protocol` includes `sip`;
   - ticket present → `consume()` (single use; expired/unknown → 401).
2. **Handshake** (subprotocol `sip`, `maxPayload` 64 KiB). It completes within milliseconds, well before engine.io's 1 s timer for unknown upgrades.
3. **Re-authorisation:** load the agent from the DB and run `effectiveWebrtc()`. The agent must be active, internal and enabled, the mode must allow WebRTC, and the contact extension must still equal the ticket's extension. Failure → close `4403`.
4. **Isolation:** if the agent already has a relay session, the older one is closed with `4409 replaced`.
5. **Upstream:** `new WebSocket(SIP_RELAY_UPSTREAM_URL, 'sip')`, 10 s handshake timeout, TLS verified (optional CA file). The upstream must agree to `sip`. Browser frames received meanwhile are queued (at most 20 frames / 64 KiB) and flushed in order.
6. **Forwarding:**
   - Text frames are forwarded **byte-for-byte**: no rewriting and no re-framing.
   - Browser → FreeSWITCH frames are validated: a SIP request or response, or a CRLF keep-alive.
   - Identity rules: the `From` user must equal the ticket extension on out-of-dialog/dialog-creating requests (REGISTER, INVITE without To-tag, SUBSCRIBE, MESSAGE, OPTIONS, REFER, PUBLISH). REGISTER also needs `To` = extension. Any `Authorization`/`Proxy-Authorization` username must equal the extension. In-dialog requests must have the extension in `From` or `To`.
   - Binary frames are rejected (1003). Violations close with `4400`/`4403`.
7. **Limits:** 30 frames/s per connection (burst 60). After 5 REGISTER authentication failures in 5 minutes, the agent is closed `4429` and blocked for the rest of that window, which protects the shared backend IP at FreeSWITCH.
8. **Heartbeat:** ping both legs every 20 s; terminate when no pong arrives within 10 s. When either leg closes, the other is closed.
9. **Events for CP3-D:** `session-open`, `registered` (REGISTER 200 with expires > 0), `unregistered`, `session-close` `{agentId, extension, reason}`. CP3-C emits these but nothing consumes them yet.
10. **Shutdown:** stop accepting; close browsers with 1001, then upstreams; terminate whatever is left after 5 s. Called before `server.close()`.

## Logging
Each connect and close is logged with: connection id, agentId, extension, client IP, close code and counters.

Never logged: frames, SDP, ticket values (only `ticket#xxxx`), Authorization headers or passwords.

## Out of scope (later checkpoints)
- PHONE_OFFLINE, grace timers and "disable after call" timing (CP3-D).
- Agent Desktop switching to tickets and the relay (CP3-E).
- nginx WebSocket upgrade for `/cc/api/sip-relay` (FS-CP CP4).
- TURN.
