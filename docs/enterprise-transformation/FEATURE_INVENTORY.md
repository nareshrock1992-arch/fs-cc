# Feature Inventory (cycle 1, code inspection + test suites)

Legend: 1 implemented & verified · 2 partially working · 3 implemented, not tested live · 4 UI-only · 5 backend-only · 6 missing · 7 known limitations. "Verified" means owner real-use or running-system check recorded in docs.

| Area | Feature | State | Evidence / note |
|---|---|---|---|
| Auth | admin/supervisor login, roles, permissions | 3 | unit tests; now rate limited |
| Auth | agent PIN login | 1 | used daily by owner |
| Admin | users CRUD, permissions | 3 | tests |
| Admin | agents CRUD, PIN set, contact/type | 3 | tests |
| Admin | queues CRUD, tiers, XML export + reload | 3 | tests (`queueXmlGeneration`, `queueTierValidation`) |
| Admin | break codes | 3 | tests |
| Admin | business hours / holidays | 6 | none |
| Admin | skills-based routing | 6 | only mod_callcenter tiers (levels/positions) |
| Admin | tenants / multiple contact centres | 6 | ARCH-1 |
| Admin | audit log viewer | 5 | `audit_log` table + `auditService`, no UI found |
| Routing | mod_callcenter strategies | 3 | depends on FreeSWITCH; per-strategy live test not recorded |
| Routing | callback, overflow, EWT announcements | 6 | |
| Agent | status Ready / Not ready / breaks | 1 | owner use |
| Agent | wrap-up (ACW) timer, disposition | 6 | CC-1 |
| Voice | WebRTC register, inbound, outbound, mute, hold, DTMF | 1/3 | registration + answer + DTMF verified; mute/hold audio pending owner |
| Voice | blind transfer | 1 | owner 2026-11-10 |
| Voice | consult transfer | 3 | 185 tests, owner pending |
| Voice | conference | 6 | WEBRTC-C1 |
| Voice | recording, recording access | 6 | not found in CC backend |
| Supervisor | Live Operations, live agents/calls, pre-queue monitor | 3 | tests (`liveAgents`, `preQueue*`) |
| Supervisor | listen / whisper / barge | 6 | SUP-1 |
| Reports | queue performance, agent performance, agent daily, IVR paths, call volume, CDR, sessions, activity, breaks, call history, export (CSV) | 3 | many unit tests on metrics; export capped at 5000 rows (check UI tells the user — open item) |
| Reports | SLA, ASA, AHT formulas documented | 7 | formulas exist in `metricsSql.js`; formula register not written yet |
| CRM | customer profile, notes, disposition, webhooks | 6 | |
| Omnichannel | chat / WhatsApp / email | 6 | agent desktop interaction model (`correlate.js`) is channel-ready on the UI side only |
