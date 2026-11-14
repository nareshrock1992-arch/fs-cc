# Daily Progress

## 2026-11-11 — Cycle 1
- Verified repo (`main` @ `0e082cb8`, clean, in sync with GitHub) and environment boundaries; created one-way test copy flow.
- Baseline: backend 395/396 (test-isolation bug), agent desktop 185/185, builds ✓, admin portal has no tests.
- Fixed: BUG-001, SEC-1 (P0), SEC-3 (P0), SEC-2, SEC-4, BUG-002, BUG-003.
- After: backend **406/406**, agent desktop 185/185, typecheck ✓, both builds ✓.
- Not done: running-system verification (would require deploying to live DEV — needs owner approval); nothing committed (mission rule: no automatic commits).

### Deploy + runtime verification (2026-11-11, owner approved)
- Commit `aa2f0243` pushed to GitHub. Ubuntu-FS had no DNS (github.com unresolvable), so DEV was fast-forwarded from the laptop repo (same commit, `git pull --ff-only /mnt/c/.../fs-cc main`); `pm2 restart fs-backend`; `/api/health/ready` → db ✓ esl ✓.
- SEC-2: 10 wrong PINs → 401 ×10, 11th → **429** ✓ (fake agent id `zz-limiter-test`).
- SEC-1: agent token on `/api/calls/live`, `/api/agents`, `/api/stats/dashboard` → **403**; supervisor token → 200; no token → 401; agent token on `/api/agent-desk/esl-status` → 200 ✓.
- SEC-4: `GET /api/agents/:id` → `pin_hash` boolean, no bcrypt text ✓.
- SEC-3: anonymous socket received `esl:status` only; supervisor socket authenticated ✓. Call events not observed (no calls during the 8 s window) — owner check of live pages pending.
- Seen in logs (pre-existing, not from cycle 1): `[esl] push queue SAPAPPS@YASREF add failed: -ERR no reply` → logged as BUG-004.

## 2026-11-11 — Cycle 2
- BUG-004 root cause found (fs_cli: `callcenter_config queue add SAPAPPS@YASREF` → `-ERR no reply` while the queue is loaded). Fixed: parameters applied when the queue is already loaded. 4 tests.
- SEC-6: security headers + 100 kB JSON limit + X-Powered-By off, no new dependency. 1 test.
- TEST-1 BLOCKED: npm install impossible (Ubuntu-FS DNS down).
- Suites: backend **411/411**, agent desktop 185/185, typecheck ✓, builds ✓.
- Not committed / not deployed (awaiting owner).

### Cycle 2 deploy + correction (2026-11-11)
- `367b6439` deployed: SEC-6 verified on DEV (headers present, no X-Powered-By, 200 kB JSON → 413).
- BUG-004 first fix was wrong: FreeSWITCH still showed max wait 0 while DB says 300. FreeSWITCH help text and `mod_callcenter.c` show **no `queue add` / `queue set`** in 1.10.12. Corrected in `18cd1e21`: queue load only, no unsupported commands, startup drift report. DEV log now: `max_wait_time is "0" in FreeSWITCH but "300" in the database` for all 3 YASREF queues.
- New: OPS-1 (needs owner decision), UI-1.
- Suites: backend 412/412, agent desktop 185/185, builds ✓.

## 2026-11-13 — OPS-1
- Owner chose "keep no limit". DEV DB `queues.max_wait_time` 300 → 0 (3 YASREF queues); `pm2 restart fs-backend`; drift log: 0 settings differ. No caller-facing change. Docs not yet committed.

## 2026-11-13 — Cycle 3 (part 1: UI-1)
- UI-1 fixed: drift endpoint + Queues page warning. Backend **415/415**, agent desktop 185/185, both builds ✓ (test copy).
- BUG-005 discovered (route order). Not committed / not deployed (awaiting owner). Next: WebRTC C1 conference.
- UI-1 deployed (`6161c53`) and VERIFIED on DEV (drift API answers, 0 differences, 401 without token).

## 2026-11-13 — Cycle 3 (part 2: WebRTC C1 conference)
- Built merge-to-conference (room 30xx from the existing dialplan; no FreeSWITCH change). Agent desktop **189/189**, backend 415/415, builds ✓. Not committed / not deployed; real call NOT VERIFIED.

## 2026-11-14 — Cycle 4 (part 1)
- Owner real call: consult + Complete transfer OK (T2 partly verified). Conference reached the room; owner to confirm 3-way audio + Leave.
- BUG-005 confirmed on DEV (preview-xml → 404 "Queue not found") and fixed (route order) + test.
- PERF-1: admin pages lazy-loaded; main chunk 858 kB → 283 kB.
- Suites: backend **416/416**, agent desktop 189/189, builds ✓. Not committed / not deployed.
- Deployed `7b25ab5` (owner approved). BUG-005 VERIFIED (preview-xml 200 for admin, 403 supervisor). PERF-1: all page modules compile on DEV, login page clean; signed-in click-through left to owner.

## 2026-11-14 — Cycle 4 (part 2)
- SEC-5 fixed: logout de-authenticates the live-event socket (server + both apps) + test. Backend **417/417**, agent desktop 189/189, builds ✓. Not committed / not deployed.
- SEC-8 found (P1): stock dialplan extension 779 lets any phone listen to all calls. Not changed (FreeSWITCH config needs owner approval).
- SUP-1 plan written: SUPERVISOR_MONITORING_PLAN.md.
- SEC-8: owner chose not now (DEFERRED, risk accepted for now).
- Owner real calls: consult + hold + conference + complete transfer all work → T2 and C1 VERIFIED (FS log 17:03: hold re-INVITE, REFER both legs to 3000).
- UX-1: Conference tile now usable right after answering (opens "Add to conference" → Call colleague → Conference all three). +1 test. Not deployed.

## 2026-11-14 — UI brief, step 0
- Live Operations analysis written (FSCC_LIVE_OPERATIONS_REDESIGN.md) from owner screenshots.
- BUG-006 found and fixed: SLA target now its own per-queue setting (`sla_seconds`, default 20 s, migration 012). Backend 422/422, agent desktop 190/190, builds ✓. Not committed / not deployed.
- Live Operations redesign built and previewed (wide + phone); not committed / not deployed.

## 2026-11-14 — Admin pages: shared look
- Audit: 12 of 14 pages hard-coded greys (≈380) and their own table styles.
- Moved all admin pages + report components to colour tokens and the shared table classes (`data-table`, `th`, `td`). FSCC_ENTERPRISE_DESIGN_SYSTEM.md written.
- Preview checked (light + dark): Agents, Queues, Dashboard, Reports, Break Codes, Users, Queue Stats, Agent Performance render correctly. Not committed / not deployed.

## 2026-11-14 — Dashboard simplified (owner request)
- Dashboard is now "today's summary": offered / answered / abandoned / service level / avg wait / utilization strip, calls by hour, "where calls were lost" (queue vs ringing agent), queues-today table. Live items (waiting, agent status, activity feed) removed — they live in Live Operations (link at top).
- Preview checked at 1440 px with real data. Not committed / not deployed.
- Seen: hourly chart (queue_stats_hourly, completed calls) can total less than "calls offered" (calls table) — pre-existing data-source difference, logged as DATA-1.
- Seen: DEV services all restarted ~18:44 and FreeSWITCH restarted via systemd at 19:09 (not by this session); load average up to 18 on 4 CPUs / 3.8 GB RAM.
