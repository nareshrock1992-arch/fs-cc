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
