# FS-CC Master Product Audit

Cycle 1 · 2026-11-11 · laptop repo `C:\Users\naresh\Documents\fs-cc`, branch `main`, base commit `0e082cb8` (= `origin/main`, tree clean at start).

## 1. Verified environment boundaries

| Item | Value | Rule |
|---|---|---|
| Source of truth | laptop `Documents\fs-cc` | all edits here |
| WSL distro | `Ubuntu-FS` (192.168.1.124, bridged) | test only |
| **Live DEV (do not touch)** | `/opt/freeswitch-ui/fs-cc` (git checkout of `origin/main`) run by pm2: `fs-backend` :4000, `fs-frontend`, `fs-agent` :8080 (Vite dev), plus `fs-enrs-backend`; PostgreSQL 127.0.0.1:5432; FreeSWITCH ESL 127.0.0.1:8021 | only `git pull --ff-only` after owner-approved push |
| **Test copy** | `/root/test/fs-cc` (no git) | refreshed one-way by `rsync --delete` from the laptop (excludes `node_modules`, `.env*`, `.git`, `dist`); dependencies copied once from the live tree |
| Sync + test script | `scratchpad/sync_test.sh` (session scratchpad), documented in `TEST_STRATEGY.md` | never writes to `/opt` |

## 2. Baseline (before any change)

| Suite | Result |
|---|---|
| backend (vitest, 32 files) | 395 / 396 — 1 failure `queuesRbac.test.js › updatePermissions rejects view_queues` |
| agent-desktop (vitest, 14 files) | 185 / 185 |
| agent-desktop typecheck / build | clean / ✓ |
| admin frontend build | ✓ (warning: main chunk > 500 kB) |
| admin frontend tests | **none exist** |

Baseline failure analysis: test-isolation defect (shared `mockQuery` not cleared, earlier test's calls counted). Application code correct. Fixed in the test (BUG-001).

## 3. Product shape (from code)

- **Backend** Node/Express + PostgreSQL + `modesl` ESL → mod_callcenter. 9 route groups, 11 controllers, socket.io for live events. Single-tenant (no tenant column anywhere).
- **Admin portal** (`frontend/`, React/Vite): Dashboard, Live Operations, Live Agents, Live Calls, Queue Stats, Queues, Agents, Break Codes, Users, Reports (+ agent performance).
- **Agent desktop** (`agent-desktop/`): login, workspace with WebRTC phone (dial, answer, mute, hold, DTMF, blind + consult transfer), status/breaks, recent calls.
- **Data**: agents, agent_tiers, queues, calls, agent_state_log, agent_sessions, agent_state_events, break_codes, audit_log, users.

## 4. Headline findings (cycle 1)

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-1 | **P0** | Agent Desktop JWTs (role `agent`) were accepted by the whole admin API (`app.use('/api', requireAuth)`): any agent could read all live calls with caller numbers, all agents, stats, queues | FIXED + tested |
| SEC-3 | **P0** | Socket.IO broadcast every call/agent event (caller numbers) to **any** connected socket, authenticated or not | FIXED + tested |
| SEC-2 | P1 | No brute-force protection on admin login or agent PIN login | FIXED + tested |
| SEC-4 | P1 | `GET /api/agents/:id` returned the bcrypt PIN hash | FIXED + tested |
| BUG-002 | P1 | Agent desktop lost its private socket room after any reconnect (only authenticated once) → missed offers/state events | FIXED (unit-tested indirectly; runtime NOT VERIFIED) |
| ARCH-1 | P2 | No multi-tenant model | DISCOVERED — needs owner decision (see gap analysis) |
| TEST-1 | P2 | Admin portal has zero automated tests | DISCOVERED |

Full list: `MASTER_TASK_TRACKER.md`.
