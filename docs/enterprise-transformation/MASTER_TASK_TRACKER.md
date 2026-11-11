# Master Task Tracker

Priorities: P0 security/data/service-breaking · P1 core CC failure · P2 enterprise gap · P3 refinement.
Statuses: DISCOVERED · INVESTIGATING · READY · IN_PROGRESS · FIXED · TESTING · VERIFIED · BLOCKED · DEFERRED.
"VERIFIED" = automated tests **and** checked in a running system. Unit-tested only = FIXED.

| ID | Module | Description | Root cause | Impact | Sev | Status | Tests / evidence |
|---|---|---|---|---|---|---|---|
| BUG-001 | backend tests | `queuesRbac` permission test failed | `mockQuery` shared across tests, never cleared | red baseline hides real regressions | P2 | FIXED | backend 396/396 → now 406/406 |
| SEC-1 | backend auth | agent token accepted on admin API | `requireAuth` verified signature only, not role | agents read every caller number, agent list, stats | P0 | VERIFIED | `securityHardening.test.js` SEC-1 (3 tests). DEV 2026-11-11: agent token → 403 on admin API, 200 on agent-desk |
| SEC-2 | backend auth | no login rate limit | none implemented | PIN brute force (4–6 digits) | P1 | VERIFIED | SEC-2 (3 tests); DEV: 11th wrong PIN → 429. Limit 10 failures / 15 min per client IP + login name; 429 + Retry-After. Note: behind a proxy `req.ip` is the proxy, so the key is effectively per login name |
| SEC-3 | backend socket | live events to unauthenticated sockets | `io.emit` broadcast to all | caller numbers to anyone reaching the port | P0 | VERIFIED | DEV: anonymous socket gets esl:status only. SEC-3 (3 tests): events → room `subscribers` only; joined on agent/supervisor authenticate |
| SEC-4 | backend agents | PIN hash in agent detail | `SELECT *` returned as-is | offline cracking of agent PINs | P1 | VERIFIED | DEV: boolean, no bcrypt text. SEC-4 test; field kept as boolean (same as list) for UI compatibility |
| BUG-002 | agent desktop socket | room lost after reconnect | authenticate sent once per token | missed `agent:offering`, state events after Wi-Fi blip | P1 | FIXED | token kept in memory, re-sent on every `connect`. Runtime NOT VERIFIED |
| BUG-003 | admin portal socket | supervisor socket not authenticated until reconnect after login | auth only on `connect` | after SEC-3, live pages would stay empty until refresh | P1 | FIXED | `setToken` fires `cc-token-changed`, socket authenticates. Runtime NOT VERIFIED |
| BUG-004 | backend ESL | startup log: `push queue SAPAPPS@YASREF add failed: -ERR no reply` | not investigated | a queue may be missing in mod_callcenter after restart | P1 | DISCOVERED | DEV log 2026-11-11 |
| SEC-5 | backend socket | sockets stay in `subscribers` after logout (until page reload) | no de-auth event | low: same browser session | P3 | DISCOVERED | — |
| SEC-6 | backend | no security headers (helmet), no JSON body size limit set explicitly | not configured | hardening | P2 | DISCOVERED | needs dependency check (no new deps without review) |
| SEC-7 | backend | JWT kept in `localStorage` (admin) | design | XSS → token theft | P2 | DISCOVERED | design change; plan with owner |
| ARCH-1 | all | no tenant model | single-tenant design | blocks multi-tenant CCaaS | P2 | BLOCKED | needs owner business decision (gap analysis §1) |
| TEST-1 | admin portal | no automated tests | never set up | regressions invisible | P2 | READY | add vitest like agent-desktop |
| PERF-1 | admin portal | main JS chunk > 500 kB | no code splitting | slow first load | P3 | DISCOVERED | route-level `lazy()` |
| WEBRTC-T1 | agent desktop | blind transfer | — | — | P2 | VERIFIED | owner real call 2026-11-10 (extension + IVR) |
| WEBRTC-T2 | agent desktop | consult transfer | — | — | P2 | TESTING | 185 tests; owner real-call test pending |
| WEBRTC-C1 | agent desktop | conference | — | — | P2 | READY | plan approved structure in `docs/enterprise/WEBRTC_STEP2_…` |
| CC-1 | agent desktop / backend | wrap-up (ACW) timer + disposition codes | not implemented | no ACW / disposition reporting | P2 | DISCOVERED | needs schema (disposition table) |
| SUP-1 | supervisor | listen / whisper / barge | not implemented | — | P2 | DISCOVERED | needs ESL `eavesdrop` API + permission |
