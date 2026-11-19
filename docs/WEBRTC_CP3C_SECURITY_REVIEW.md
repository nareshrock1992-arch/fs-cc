# CP3-C Checkpoint 1 — Dependency and Security Review (read-only)

Date: 2026-11-19 · FS-CC laptop repo. Nothing installed. `package.json` and `package-lock.json` are unchanged. No DEV or FreeSWITCH changes: the only DEV contact was reading which ports are listening.

## 1. Dependency assessment: `ws`

| Question | Finding |
|---|---|
| Latest stable | `8.23.0` (published 2026-11-12, 7 days ago). Recent: 8.22.2 (2026-11-08), 8.22.0 (2026-09-26), **8.21.0 (2026-05-22)** |
| Already in FS-CC? | **Yes.** `socket.io@4.8.3 → engine.io@6.6.9 → ws@8.21.0`, also used by `socket.io-adapter`. It is installed at `backend/node_modules/ws` today and runs in production inside Socket.IO. |
| Node.js compatibility | `engines: node >=10`. FS-CC runs Node 20 (Dockerfile `node:20-alpine`), Node 22.22.1 on Ubuntu-FS and Node 26 on the laptop. All compatible. |
| Known vulnerabilities | `npm audit --omit=dev` reports **no advisory against `ws`**. Historical advisories are fixed in 8.21.0: CVE-2024-37890 (DoS through too many HTTP headers, fixed 8.17.1) and CVE-2021-32640 (ReDoS, fixed 7.4.6). |
| Licence | MIT. Compatible, and the same licence as express and socket.io already in use. |
| Maintenance | Active: four releases in the last two months. Main repo `github.com/websockets/ws`, maintained by the Node.js ecosystem's long-time WebSocket maintainer. It is among the most-downloaded npm packages. |
| Runtime and dependency impact | **No runtime dependencies.** Optional peers `bufferutil` and `utf-8-validate` are not needed and won't be installed. Declaring `ws` directly at the already-installed version adds **no new code** to the image; only `package.json` and the lockfile's top-level entry change. |
| Can an existing dependency do it? | **Socket.IO: no.** It uses its own framing (Engine.IO packets), but SIP.js needs a plain RFC 6455 WebSocket with the `sip` subprotocol (RFC 7118). **Node's built-in `WebSocket` (Node 22+): client only**, no server, and FS-CC's production image is Node 20. **Socket.IO's internal `ws` instance:** possible to reach, but it relies on internals that aren't public; not acceptable. So `ws` is the right tool, and it is already vetted by being inside Socket.IO. |

**Recommendation**
- Add `"ws": "~8.21.0"` to `backend/package.json` dependencies. This is the version already installed and audited in the tree, so there is no download and no new code.
- The `~` range allows patch releases only.
- Upgrade to the 8.22/8.23 line later, together with Socket.IO, once those releases have aged. Socket.IO currently pins its own copy to 8.21.x anyway.

### Separate finding: existing production audit results (not caused by this work, not fixed here)
`npm audit --omit=dev` on the current FS-CC backend reports 9 issues: 1 critical, 3 high and 5 moderate. All have fixes available.

| Severity | Package | Path | Issue |
|---|---|---|---|
| critical | proxy-addr | via express | IP spoofing with an IPv4-mapped IPv6 trust subnet (<2.0.8) |
| high | engine.io | via socket.io | Protocol revision mismatch DoS (6.6.0–6.6.9) |
| high | socket.io-parser | via socket.io | Zero-attachment memory exhaustion (<4.2.7) |
| high | body-parser | via express | DoS with an invalid limit value (<1.20.6) |
| moderate | morgan (direct) | | Log forging / injection (<1.12.0) |
| moderate | qs, uuid, xml2js (via modesl), modesl (direct) | | DoS, bounds check, prototype pollution |

These need a separate, approved dependency-update task ("SEC-DEP-1"), with a full regression run. The engine.io and socket.io-parser items are relevant to the agent desktop's live connection today.

## 2. How the browser phone talks to FreeSWITCH today (verified in source)
- **Signalling:** SIP.js 0.21.2 (`engine/src/sip/sip-client.ts`) opens a plain WebSocket to `creds.wssUrl` with the `sip` subprotocol (SIP.js default). It sends CRLF keep-alives every 30 s, REGISTER expires is 300 s, and the connection timeout is 10 s.
- **Authentication:** SIP digest. The browser answers FreeSWITCH's 401/407 challenge itself (`authorizationUsername` = extension, `authorizationPassword` = typed password). The password never leaves the browser in clear text. Only the digest *response* travels on the wire.
- **SDP, ICE and media:**
  - SDP is carried inside SIP INVITE/200 bodies, as text over the same WebSocket.
  - ICE uses `iceServers: []` (host candidates only) with a 1 s gathering timeout.
  - DTLS-SRTP media flows **browser ↔ FreeSWITCH RTP ports directly** (UDP 16384–32768 by default). **Media never goes through FS-CC.**
- **FreeSWITCH listeners on Ubuntu-FS (read-only check):**
  - `192.168.1.124:5066` (WS, plain);
  - `:7443` (WSS, TLS, the mkcert lab certificate);
  - `:5060` (SIP UDP/TCP);
  - ESL `127.0.0.1:8021`.

## 3. What a relay changes, and what it doesn't

| Concern | Effect of the relay | Requirement |
|---|---|---|
| SIP over WebSocket (RFC 7118) | The relay must pass text frames **unchanged**, negotiate subprotocol `sip` on both sides, and keep **one upstream connection per browser connection**. FreeSWITCH binds a registration to the WS connection it arrived on and sends inbound INVITEs back down that same connection. | 1:1 socket pairing; no sharing or multiplexing; no rewriting |
| SIP authentication | Unchanged. Digest is between browser and FreeSWITCH; the relay sees only the hashed response. | The relay must not log frame bodies |
| Who may speak for which extension | **New control.** The relay parses only the request line plus `From`/`To` of REGISTER, and `From` of INVITE/SUBSCRIBE/MESSAGE/OPTIONS/REFER. It closes the socket if the user part ≠ ticket extension. | Header-only parse with strict size limits |
| SDP / ICE | Unchanged, because it is text inside SIP. Host candidates still point at the browser's own IP. | None |
| STUN/TURN | Not affected by the relay. LAN deployments work as today. Remote agents across NAT will later need TURN, a separate future item that applies with or without the relay. | Document only |
| RTP media path | Unchanged, direct browser ↔ FreeSWITCH. The CP5 firewall rules for RTP are still required. | Document only |
| FreeSWITCH sees the source IP | **Changes:** all WebRTC registrations now arrive from the FS-CC backend's IP, not each browser's. Three effects follow. | See risks R1–R3 |
| TLS to FreeSWITCH | The browser now trusts **FS-CC's** certificate (nginx `/cc/`). The relay → FreeSWITCH hop is either `wss://…:7443` (the backend must trust that certificate through `NODE_EXTRA_CA_CERTS`, with no insecure bypass in production) or `ws://…:5066` **only** on a private host/LAN segment between backend and FreeSWITCH. | Env `SIP_RELAY_UPSTREAM_URL`; optional `SIP_RELAY_CA_FILE` |
| Browser certificate | The browser no longer needs to trust FreeSWITCH's 7443 certificate at all. This removes today's per-laptop mkcert trust step (a benefit). | — |

**No FreeSWITCH configuration change is required**: the existing `ws-binding`/`wss-binding` are reused.

## 4. Risks found and planned controls

| # | Risk | Control in CP3-C |
|---|---|---|
| R1 | FreeSWITCH or fail2ban rate limiting or banning by source IP: one agent's wrong passwords could block **every** agent, because they all share the backend IP | Relay counts 401/403 REGISTER responses per agent and closes that agent's socket after 5 in 5 min. Documented: allowlist the backend IP in any fail2ban/ACL, and keep `apply-inbound-acl` unchanged for desk phones. |
| R2 | FreeSWITCH NAT handling with `received`/`rport` now points at the backend, which is correct since replies must go to the relay | None needed; verify in CP8 that inbound calls reach the right agent |
| R3 | FreeSWITCH logs show the backend IP, not the agent's | Relay logs `agentId`, `extension`, browser IP and a connection id on connect/close, so the two logs can be correlated |
| R4 | Ticket replay or theft | Already in CP3-B: single use, 30 s, 256-bit. The relay consumes before opening upstream and accepts the ticket only in the query string of the upgrade, never in later frames. |
| R5 | Cross-agent signalling | One upstream per browser socket. Per-frame `From` check against the ticket extension. A second socket for the same agent closes the older one. |
| R6 | Resource exhaustion | `maxPayload` 64 KiB; max 30 frames/s per connection; max 1 relay socket per agent; global cap of connections (env, default 500); upgrade attempts limited to 20/min per IP; 10 s upstream connect timeout |
| R7 | Dead connections | WebSocket ping every 20 s on both legs; terminate when no pong arrives within 10 s; when either leg closes, close the other |
| R8 | Cross-site WebSocket | `Origin` must be in `CORS_ORIGIN`; subprotocol must be exactly `sip`; binary frames rejected |
| R9 | Exposure in EXTERNAL_PBX | The relay is not attached at all, so the upgrade request is destroyed (socket closed without a handshake) |
| R10 | Permission removed while connected | Revalidated on every new connection. An open call isn't dropped mid-call, as the addendum requires; CP3-D adds the "close after call" timing. |
| R11 | Graceful shutdown | On SIGTERM: stop accepting upgrades, send close 1001 to browsers and upstream, wait at most 5 s, then terminate |
| R12 | Logging secrets | Never log frames, tickets (only `ticket#xxxx`), `Authorization` headers or SDP. Only the SIP method, status code and sizes are logged. |

## 5. Decision needed
- Approve adding `"ws": "~8.21.0"` (already installed, MIT, no dependencies) to `backend/package.json` and the lockfile.
- Separately, decide on a dependency-update task for the 9 existing audit findings, which are unrelated to this work.

---

## 6. Outcome after implementation (2026-11-19)
- **Approved and applied:** `"ws": "~8.21.0"` in `backend/package.json`. The lockfile resolves to **ws 8.21.0**, the copy Socket.IO already uses (deduped).
  - `npm install` first chose 8.21.3, which would also have changed Socket.IO's copy, so it was **reverted**.
  - Verified: no other package version changed, and `npm ci --omit=dev` from the lockfile gives `ws@8.21.0`.
- **Controls R4–R12** are implemented and covered by automated tests (`WEBRTC_CP3C_REPORT.md`).
- **R1:** the relay-side control is done (per-agent sign-in failure limit). The FreeSWITCH-side allowlisting of the backend address remains a deployment step.
- **R2 and R3:** CP8 checks.
- **SIP compatibility:** proven against real **SIP.js 0.21.2** (see the report), not only by generic WebSocket forwarding.
- **Still open, unchanged:** the 9 existing `npm audit` findings (SEC-DEP-1), awaiting an owner decision.
