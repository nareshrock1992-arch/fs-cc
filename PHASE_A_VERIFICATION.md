# Phase A — Read-Only Environment & Deployment Verification (FS-CC Break Codes)

> **Read-only.** No code, migration, DB record, service, commit, or push was changed.
>
> **Environment boundary (critical):** This machine is the **fs-cc source / build box**, not the
> runtime. Verified facts: no fs-cc backend process is listening (`:4100` not bound), **no Docker
> containers are running** (WSL docker store empty of running containers), and no `psql` client is
> installed. `backend/.env` points the app at `DB_HOST=localhost / DB_NAME=fs_cc`, i.e. the DB is
> expected to be co-located with the *running* backend — which is on your **DEV/customer server**,
> not here. Therefore the **live-data sections (§4 DB, §5 agents, §6 API, §7 trace, §8 race)
> cannot be executed from this environment** — presenting any local DB rows as if they were your
> test system's data would be a guess, which the brief forbids. Those sections below give the
> exact read-only SQL/commands to run **on the server**, and the source-verified expectations to
> compare against. Everything version/source/code-side (§1–§3, §9) **is** fully verified here.

---

## 1. Environment / version verification

| Item | Value |
|---|---|
| git branch | `main` |
| git HEAD (source tree) | `dd9096b` "fs-cc agent ui improvement" |
| git status | clean except this report + `BREAK_CODE_INVESTIGATION.md` (untracked) |
| Deployed commit (per `fs-cp/DEPLOYMENT_NOTES.md`) | **`617bb8c`** → image tag **`omni/cc-backend:1.1.0` / `omni/agent-desktop:1.1.0`** |
| `93041b2` "agent UI Break" | **ancestor of HEAD ✓ and of deployed 617bb8c ✓** |
| `9feb77c` "fs-cc agent live status" | **ancestor of HEAD ✓ and of deployed 617bb8c ✓** |
| Running backend version | **NOT DETERMINED FROM THIS ENVIRONMENT** (no backend process here) |
| Running Docker image tag on customer host | **NOT DETERMINED FROM THIS ENVIRONMENT** (no containers here) |
| Frontend build timestamp on customer host | **NOT DETERMINED FROM THIS ENVIRONMENT** |
| PM2 info | Not applicable — deploy model is Docker Compose (`fs-cp/deploy/docker-compose.yml`), not PM2 |

**Beyond "the commits exist":** both break commits are not merely present in the repo — they are
**ancestors of the deployed commit 617bb8c**, and the deployed blob content confirms the feature
is compiled into the 1.1.0 source (verified in §2). So *if* the customer runs 1.1.0, the code is
there. Whether the customer actually runs 1.1.0 (vs. an older 1.0.0 image with no break codes) is
the open question for §9.

**To confirm on the server (read-only):**
```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.CreatedAt}}' | grep -E 'cc-backend|agent-desktop'
docker inspect --format '{{.Config.Image}} {{.Created}}' <agent-desktop-container>
docker exec <cc-backend-container> sh -c 'cat /app/package.json | grep version'   # if version is set
```

---

## 2. Deployed Agent-UI code (verified from the 617bb8c blobs, not assumed)

- `agent-desktop/src/components/CurrentBreakPanel.jsx` @617bb8c, line 48:
  ```jsx
  <p className="text-sm font-bold text-ink truncate">{breakName || breakCode || 'Break'}</p>
  ```
- `agent-desktop/src/components/BreakHistory.jsx` @617bb8c, line 75:
  ```jsx
  {r.break_name || r.break_code || 'Break'}
  ```
- `agent-desktop/src/pages/Dashboard.jsx` @617bb8c — passes the props and reconciles:
  ```jsx
  <CurrentBreakPanel breakName={agent.break_name} breakCode={agent.break_code} … />
  // handleStatusChange → await syncMe();  // line 267: reconcile break_code/break_name/break_started_at
  // syncMe() (line 247) fetches api.me() and sets break_code/break_name into agent state
  ```
- `backend/controllers/agentDeskController.js` @617bb8c — `agentMe` contains the join
  `LEFT JOIN break_codes bc ON bc.code = a.break_code` (1 match).

**Verdict for §2:** the deployed source renders the real code name and self-reconciles after a
selection. There is **no source-level rendering bug in 1.1.0**.

---

## 3. Actual Agent → Backend request (verified from current source)

- Route: `POST /api/agent-desk/status` (`backend/routes/agentDesk.js:14` → `desk.agentSetStatus`).
- Client: `agent-desktop/src/api/client.js` — `setStatus(status, breakCode)` sends
  `breakCode ? { status, break_code: breakCode } : { status }`.
- Trigger: `StatusControls.jsx` renders one button per configured code and calls
  `post('On Break', bc.code)` (i.e. `break_code` = the catalogue `code`, e.g. `LUNCH`/`MEETING`).
- Backend normalizes to upper-case and validates against `break_codes WHERE code=$1 AND active AND agent_selectable`.

### Agent selects **Lunch**
```http
POST /api/agent-desk/status
Content-Type: application/json
{ "status": "On Break", "break_code": "LUNCH" }
```
Backend response (source-verified, `agentSetStatus` return):
`{ "agent_id": "...", "status": "On Break", "break_code": "LUNCH", "break_name": "Lunch" }`

### Agent selects **Meeting**
```http
POST /api/agent-desk/status
{ "status": "On Break", "break_code": "MEETING" }
```
Response: `{ …, "break_code": "MEETING", "break_name": "Meeting" }`

> Caveat: `break_code` is literally whatever `bc.code` is in the seeded `break_codes` table.
> Seed (migration 007) uses `LUNCH/MEETING/TRAINING/COFFEE/OTHER`. If an operator renamed codes,
> the actual value differs — **NOT DETERMINED FROM CODE** without reading the live table (§4).

---

## 4. Database evidence — **NOT DETERMINED FROM THIS ENVIRONMENT**

Cannot query the runtime DB from here (see boundary note). Run on the server, read-only:

```sql
-- Recent break segments with the snapshot columns:
SELECT e.agent_id, e.status, e.started_at, e.ended_at, e.break_code, e.break_name, e.source
FROM   agent_state_events e
WHERE  e.status = 'On Break'
ORDER  BY e.started_at DESC
LIMIT  20;
```
**Expected if working:** rows for agent-selected breaks show `break_code='LUNCH'`,
`break_name='Lunch'`, `source='agent_self'`.
**Diagnostic pattern to look for:** rows with `break_code IS NULL` and `source='fs_event'` (or
`'manual'`) — those are automatic/FS/admin breaks that legitimately have no code (RC-1 from the
main investigation) and will render "Break".

---

## 5. Current `agents` table — **NOT DETERMINED FROM THIS ENVIRONMENT**

```sql
SELECT agent_id, status, break_code, break_started_at
FROM   agents
WHERE  status = 'On Break'
ORDER  BY break_started_at DESC;
```
**Expected if working (agent-selected Lunch):** `status='On Break'` AND `break_code='LUNCH'`.
**Document if broken:** `status='On Break'` AND `break_code IS NULL` → the current-break label
falls back to "Break". Note (source-verified): `agents.break_code` is written **only** by
`agentDeskController.agentSetStatus`; the FS path (`eslService.upsertAgentStatus`) and admin force
(`agentsController.setAgentStatus`, sets `NULL`) never populate it (RC-3).

---

## 6. API evidence — **NOT DETERMINED FROM THIS ENVIRONMENT**

Source-verified: all four endpoints select/return the code. Confirm live with a valid agent JWT:

```bash
# Agent current status (returns break_code + break_name via join):
curl -s -H "Authorization: Bearer <AGENT_JWT>" https://<host>/api/agent-desk/me
# Agent break history (returns break_code + break_name from agent_state_events):
curl -s -H "Authorization: Bearer <AGENT_JWT>" "https://<host>/api/agent-desk/break-history?limit=10"
# Supervisor live agents (returns break_code + break_name; label field is generic 'On Break'):
curl -s -H "Authorization: Bearer <SUP_JWT>" https://<host>/api/stats/live-agents      # confirm exact path in routes/stats.js
# Supervisor break history (returns break_code + break_name):
curl -s -H "Authorization: Bearer <SUP_JWT>" "https://<host>/api/reports/break-history?limit=10"
```
**Expected:** each JSON carries `break_code`/`break_name` populated for an agent-selected Lunch.
If they come back `null`, the defect is upstream (data, §4/§5), not the API.

---

## 7. One real Lunch break, end-to-end — evidence table

| Stage | Expected | Actual |
|---|---|---|
| Agent selection | `LUNCH` (button → `post('On Break','LUNCH')`) | **verified in source ✓** |
| HTTP payload | `{status:'On Break', break_code:'LUNCH'}` | **verified in source ✓** |
| Backend receives | resolves `LUNCH`→`Lunch`, `breakInfo` set | **verified in source ✓** |
| `agents.break_code` | `LUNCH` | **NOT DETERMINED** — run §5 |
| `agent_state_events.break_code` | `LUNCH` | **NOT DETERMINED** — run §4 |
| `agent_state_events.break_name` | `Lunch` | **NOT DETERMINED** — run §4 |
| agent history API | `Lunch` | **NOT DETERMINED** — run §6 |
| Supervisor API | `Lunch` | **NOT DETERMINED** — run §6 |
| Agent UI | `Lunch` | **NOT DETERMINED** — depends on deployed image (§9) + data |

The left column is fully verified; the right column requires the runtime and is the gate.

---

## 8. FreeSWITCH overwrite / race — **NEEDS LIVE IDs/TIMESTAMPS**

Source facts (verified):
1. Agent UI path writes `LUNCH` into `agent_state_events` (`source='agent_self'`).
2. FreeSWITCH emits `agent-status-change` → `eslService.js:774` calls
   `handleStatusTransition(agentId, status, 'fs_event')` **with no breakInfo** → would open a
   code-less segment.
3. Dedup guard (`agentSessionService.js:143-156`): if a segment of the same status is already
   open, a **code-less** echo does **not** overwrite an existing code
   (`breakInfo?.break_code && breakInfo.break_code !== open.break_code` is false for a null echo).
   So in the *agent-first* ordering the code survives.
4. **Open risk — ordering:** if the `fs_event` echo lands *before* the `agent_self` write (or the
   `agent_self` write fails/rolls back), the open segment is code-less; a later `agent_self` with a
   code re-opens it, but if that second call never occurs, the row stays `NULL`.

**Confirm on the live DB (read-only)** — look for a same-second pair of segments for one agent:
```sql
SELECT id, agent_id, status, break_code, source, started_at, ended_at
FROM   agent_state_events
WHERE  agent_id = '<AGENT>' AND status = 'On Break'
ORDER  BY started_at DESC
LIMIT  10;
```
If you see two adjacent On-Break rows (one `source='agent_self'` with `LUNCH`, one
`source='fs_event'` with `NULL`) and the UI reads the `NULL` one, that is the race. **Whether this
actually occurs is NOT DETERMINED FROM CODE** — needs the rows above.

---

## 9. Frontend / deployment evidence

Verified here: deployed commit **617bb8c fully contains** the correct render chain (§2). So a
"browser shows Break while source shows the name" symptom points to a **build/deploy mismatch**,
i.e. the browser is serving an **older bundle** than 617bb8c. Confirm on the server (read-only):

```bash
docker inspect --format '{{.Image}} {{.Created}}' <agent-desktop-container>   # image age
docker images | grep -E 'omni/agent-desktop'                                  # which tag is deployed (1.0.0 vs 1.1.0?)
# Inside the served bundle, check whether the string is even compiled in:
docker exec <agent-desktop-container> sh -c "grep -ro \"break_name || r.break_code\" /usr/share/nginx/html/assets | head"
```
If the agent-desktop image tag is **1.0.0** (or built before the break-code commits), the browser
renders the old generic "Break" regardless of correct backend data — this alone reproduces your
symptom. **Which tag is live is NOT DETERMINED FROM THIS ENVIRONMENT.**

---

## 10. Root cause (classified)

Given the deployed source is correct, the surviving explanations are **F, B, and possibly E** — in
that likelihood order. A, C, D are ruled out **for 1.1.0**; G is a real but separate limitation.

- **A — Source-code bug:** ❌ Ruled out. Deployed 617bb8c has the full correct chain (§2, §3).
- **B — Database/data issue:** ⚠️ **Live-plausible.** Code-less rows (`break_code NULL`) from
  FS/automatic/admin breaks render "Break" (RC-1/RC-3). Confirm via §4/§5.
- **C — Backend API issue:** ❌ Ruled out by source; all four APIs return the fields (confirm §6).
- **D — Frontend rendering issue:** ❌ Ruled out for 1.1.0; components render + `syncMe` reconciles.
- **E — FreeSWITCH event/race issue:** ⚠️ **Possible**, ordering-dependent; needs §8 rows to confirm.
- **F — Deployment/build version issue:** ⚠️ **Most likely** if agent-*selected* breaks also show
  "Break". Verify the live image tag/bundle (§9). This is the first thing to check.
- **G — Reporting-only limitation:** ✅ **Confirmed (separate).** `agentReportService.getBreakList`
  omits `break_code/break_name`; per-agent break stats are total-only. Affects the statistics/
  per-agent report path regardless of the above.
- **H — Multiple issues:** ✅ In effect: **G is real now**, and the live symptom is **F and/or B**
  (and possibly E), pending the server checks.

---

## 11. What actually needs to be changed

Nothing can be *confirmed* as needing a code change until the server checks (§4–§9) run. Based on
source alone:
- If **F** (old image): redeploy the 1.1.0 agent-desktop/cc-backend images — **no code change**.
- If **B/E** (code-less rows from FS/automatic/admin breaks): populate a reserved code on the FS
  and admin write paths + set `agents.break_code` there (Phase C of the main investigation).
- **G** (independent): add `break_code/break_name` to `getBreakList` and a per-code aggregation to
  `getAgentReport` (Phase B of the main investigation).

## 12. What does NOT need to be changed

- `CurrentBreakPanel.jsx`, `BreakHistory.jsx`, `Dashboard.jsx` wiring/`syncMe` — correct.
- `agentDeskController.agentSetStatus` / `agentMe`, `agentBreakHistory`,
  `historyController.supervisorBreakHistory`, `statsController` live-agents — all carry the code.
- The schema (`break_code`/`break_name` already exist on `agents`, `agent_state_events`,
  `agent_state_log`). No migration required for the dual model.

## 13. Recommended next implementation phase

**Do the server-side read-only checks first — do not code yet:**
1. **§9 image/bundle check** (is the live agent-desktop actually 1.1.0?). ← start here.
2. **§4 + §5** DB check (are agent-selected rows carrying `LUNCH`, or is `break_code` NULL?).
3. **§6** API check for a known Lunch break.
4. **§8** race check only if §4 shows paired rows.

The results select exactly one of: **redeploy (F)** → **Phase C write-path fix (B/E)** →
**Phase B stats fix (G)**. Until then, no code change is justified.
