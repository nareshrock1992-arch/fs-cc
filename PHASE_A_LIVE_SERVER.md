# Phase A — Live-Server (DEV 172.21.20.57) Read-Only Verification

> **Read-only. Nothing was changed** (no code, data, migration, restart, rebuild, config, commit, push).
>
> ## Access status — I could NOT log in to run these myself
> - `172.21.20.57:22` (SSH) is **reachable** from here; an `ssh` client and a `~/.ssh/config` entry
>   (`Host 172.21.20.57`, `User root`) exist.
> - The server accepts **`publickey,password`**. Key auth **fails** (`Permission denied (publickey)`
>   — no usable key here), and the config carries a **`Password`** line (a non-standard OpenSSH
>   option; used with `sshpass`, which is **not installed**).
> - Completing the login requires **entering a password to authenticate**, which I am not permitted
>   to do automatically. So every live step below is **NOT VERIFIED — REQUIRES DEV SERVER ACCESS**.
> - **Two ways to unblock:** (a) run the copy-paste **Command Pack** at the end and paste the output
>   back — I'll fill in every "Actual" cell; or (b) add a key I can use
>   (`ssh-copy-id`) so I can run them read-only myself.
>
> Everything below that is marked **verified** was verified from the **source and deploy config on
> this laptop** (real container names, tags, DB names, routes, columns) — not guessed.

---

## 1. Live Environment (identifiers are real, from `fs-cp/deploy/docker-compose.yml` + `deploy/.env`)

| Role | container_name | image (intended tag, from `.env`) | Notes |
|---|---|---|---|
| CC backend | `omni-cc-backend` | `omni/cc-backend:1.1.0` | API port bound **loopback only** `127.0.0.1:${CC_BACKEND_PORT}` |
| Agent desktop | `omni-agent-desktop` | `omni/agent-desktop:1.1.0` | nginx static; health `/nginx-health` |
| CC admin frontend | `omni-cc-frontend` | `omni/cc-frontend:1.1.0` | |
| PostgreSQL | `omni-postgres` | `postgres:16-alpine` | internal host alias `postgres` |
| Reverse proxy | `omni-nginx` | `${NGINX_IMAGE}` | public entry |
| DB (CC) | — | — | `CC_DB_NAME=fs_cc`, `CC_DB_USER=fs_cc_user` |

> The `.env` **declares** 1.1.0, but per your own caution, the **running** container's image must be
> read from `docker ps` on the server — a declared tag is not proof of what's live. **NOT VERIFIED.**

## 2. Running Version — **NOT VERIFIED — REQUIRES DEV SERVER ACCESS**
Must confirm on the box: `docker ps` image column + `docker inspect` image ID/created time for
`omni-cc-backend` and `omni-agent-desktop`, and that the agent-desktop **served bundle** actually
contains the render strings. (Command Pack steps 1–2.)
- Source fact (verified): deployed commit **`617bb8c`** — an ancestor of the running-source HEAD —
  contains the full break chain; `93041b2` and `9feb77c` are ancestors of `617bb8c`. So **if** the
  live image is genuinely built from 617bb8c/1.1.0, the code is present.

## 3. Actual Lunch Trace — **NOT VERIFIED — REQUIRES DEV SERVER ACCESS**
Left column verified from source; right column needs the server (Command Pack 4–8).

| Stage | Expected | Actual |
|---|---|---|
| Agent selection | `LUNCH` | NOT VERIFIED |
| HTTP payload `POST /api/agent-desk/status` | `{status:'On Break', break_code:'LUNCH'}` | verified in source |
| Backend resolves | `LUNCH`→`Lunch` | verified in source |
| `agents.break_code` | `LUNCH` | NOT VERIFIED (Pack 6) |
| `agent_state_events.break_code` | `LUNCH` | NOT VERIFIED (Pack 5) |
| `agent_state_events.break_name` | `Lunch` | NOT VERIFIED (Pack 5) |
| `agent-desk/me` API | `Lunch` | NOT VERIFIED (Pack 7) |
| `stats/live-agents` API | `Lunch` | NOT VERIFIED (Pack 8) |
| Agent UI render | `Lunch` | NOT VERIFIED (depends on §2) |

## 4. Actual Meeting Trace — **NOT VERIFIED — REQUIRES DEV SERVER ACCESS**
Same as §3 for `MEETING`/`Meeting`. If no Meeting row exists in test data, the correct report is
`NOT AVAILABLE IN CURRENT LIVE DATA` (Command Pack step 5b).

## 5. Database Evidence — **NOT VERIFIED — REQUIRES DEV SERVER ACCESS**
Exact schema is verified (columns exist: `agent_state_events.break_code/break_name/source`,
`agents.break_code/break_started_at`, `break_codes.code/name/active/agent_selectable`). Live rows:
Command Pack steps 4–6.

## 6. API Evidence — **NOT VERIFIED — REQUIRES DEV SERVER ACCESS**
Actual routes (verified from source):
- `GET /api/agent-desk/me` (`routes/agentDesk.js`) — selects `a.break_code`, `bc.name AS break_name`
  via `LEFT JOIN break_codes`.
- `GET /api/agent-desk/break-history` (`agentBreakHistory`) — selects `break_code, break_name`.
- `GET /api/stats/live-agents` (`routes/stats.js:9`) — selects `a.break_code, bc.name AS break_name`.
- `GET /api/reports/break-history` (`routes/reports.js:35` → `supervisorBreakHistory`) — selects
  `e.break_code, e.break_name`.
Live responses: Command Pack steps 7–8. **Note:** cc-backend is bound to `127.0.0.1` on the host, so
these curls must run **on the server** (or via the nginx public route).

## 7. FreeSWITCH Event Evidence — **NOT VERIFIED — REQUIRES DEV SERVER ACCESS**
Source facts (verified): the `agent-status-change` ESL handler (`eslService.js`) calls
`handleStatusTransition(..., 'fs_event')` with **no** `breakInfo`; the dedup guard
(`agentSessionService.js`) does **not** overwrite an existing code with a null echo. Whether a real
Lunch produced a paired `agent_self`(LUNCH)+`fs_event`(NULL) segment, and which one the UI reads, is
determinable only from live rows + timestamps (Command Pack step 5c).

## 8. Reporting Evidence — **CONFIRMED REPORTING GAP** (verified in deployed source)
`backend/services/agentReportService.js` → `getBreakList()` (lines ~318–335): its `SELECT` returns
`break_start, break_end, duration_seconds, source, is_open` and **does NOT select `break_code` /
`break_name`**, and `getAgentReport` aggregates a single `break_seconds` total with no per-code
breakdown. This is a real, code-level limitation in 1.1.0, **independent** of the live Agent-UI
question. → **`CONFIRMED REPORTING GAP`**.

## 9. Root Cause (as far as evidence allows)
- **Ruled out for 1.1.0 (source-verified):** frontend rendering, backend API shape, and the write
  path for **agent-selected** breaks all carry the code.
- **Open, needs live data — the actual symptom is one of:**
  - **Case E (deployment):** running image is older than 617bb8c/1.1.0 → verify §2.
  - **Case B (data/persistence):** rows have `break_code = NULL` → verify §5/§6.
  - **Case C (API):** DB has the code but API returns null → verify §6 vs §5.
  - **Case D (architectural, not a bug):** only automatic/FS breaks are NULL; agent-selected carry
    the code → verify §5 `source` column.
- **Confirmed now (separate):** Reporting gap (§8).
- **Most likely** given the deployed source is correct: **Case E or Case D**. **NOT VERIFIED.**

## 10. Exact Fix Required
Cannot be finalized until §2/§5/§6 run. Decision map:
- Case E → **redeploy** the 1.1.0 `agent-desktop`/`cc-backend` images. No code change.
- Case B/C → fix the specific broken write/read once the live rows show where the code is lost.
- Case D → **not a bug**; only act if business wants automatic breaks labelled (see §12, Fix 3).
- Reporting gap → **Fix 2** below (independent, safe to schedule now).

## 11. What Must NOT Be Changed
- **FreeSWITCH / mod_callcenter stays status-only** (`On Break`). Do **not** teach it Lunch/Meeting/
  Training/Coffee/Personal. FS-CC owns `break_code`/`break_name`.
- The four already-correct read APIs and the agent-desk write path.
- The schema — `break_code`/`break_name` already exist on `agents`, `agent_state_events`,
  `agent_state_log`. No migration for the dual model.
- No `AUTO`/`SYSTEM` break code introduced silently (business/reporting implications first — §12).

## 12. Proposed Implementation Plan (do NOT implement yet)
- **Fix 1 — Agent-selected break display:** implement **only if** live evidence (Case B/C/E) proves
  it's actually broken. If Case E, this is a redeploy, not code.
- **Fix 2 — Reporting/statistics (the confirmed `getBreakList()` gap):** add `break_code`,
  `break_name` to the `getBreakList` SELECT and a per-code aggregate to `getAgentReport`; surface in
  the report UI. Low risk, additive, does not touch status-based stats. Ready to schedule regardless.
- **Fix 3 — Automatic FreeSWITCH break labelling:** deferred **decision, not a default**.
  Introducing an `AUTO`/`SYSTEM` code changes what break dashboards count as "voluntary" break time
  and could skew existing per-status stats; requires an explicit business rule (should a
  missed-call auto-away show as a distinct reason, and should it be excluded from voluntary-break
  KPIs?) before any code.

## 13. Test Plan (for whichever fix is confirmed)
- **Fix 1 (if code):** unit — agent-selects-Lunch persists `LUNCH` end-to-end; DEV — select each
  code, verify row + `agent-desk/me` + live-agents + break-history all show the name; regression —
  `status='On Break'` counts unchanged.
- **Fix 2:** unit — `getBreakList` returns `break_code/break_name`; `getAgentReport` returns a
  per-code aggregate that sums to the existing `break_seconds` total; UI renders per-code rows.
- **Fix 3 (if approved):** unit — FS/auto break writes the reserved code, not a fake voluntary one;
  aggregation segregates it; dedup still never overwrites an explicit agent code.

## 14. Acceptance Criteria
1. Live evidence classifies the symptom into exactly one of Cases A–E with real rows/IDs.
2. Agent-selected breaks show the specific name on Agent UI, Live board, and Break History.
3. Reporting exposes per-code breakdown (Fix 2), status-based stats unchanged.
4. FreeSWITCH remains status-only; no schema change for the dual model.
5. Historical NULL-code rows are not backfilled.

---

## Command Pack — run on `172.21.20.57` (all READ-ONLY; paste output back)

```bash
# 1) Running deployment — real images/tags/created/ports (NOT the .env, the actual containers)
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.CreatedAt}}\t{{.Status}}\t{{.Ports}}' \
  | grep -E 'omni-(cc-backend|agent-desktop|cc-frontend|postgres|nginx)'
docker inspect --format '{{.Name}} img={{.Image}} created={{.Created}}' \
  omni-cc-backend omni-agent-desktop

# 2) Is the break-render actually in the SERVED agent-desktop bundle?
docker exec omni-agent-desktop sh -c \
  "grep -rl \"break_name || r.break_code\" /usr/share/nginx/html/assets 2>/dev/null | head; \
   grep -rl 'breakName || breakCode' /usr/share/nginx/html/assets 2>/dev/null | head" \
  || echo 'NOT FOUND IN SERVED BUNDLE  → deployment older than 617bb8c (Case E)'

# 3) DB identity used by the running backend
docker exec omni-cc-backend sh -c 'echo host=$DB_HOST db=$DB_NAME user=$DB_USER'   # no password printed

# 4) Configured break codes
docker exec omni-postgres psql -U fs_cc_user -d fs_cc -c \
 "SELECT id, code, name, active, agent_selectable FROM break_codes ORDER BY display_order, id;"

# 5) Recent On-Break segments (last 24h) WITH source + snapshot columns
docker exec omni-postgres psql -U fs_cc_user -d fs_cc -c \
 "SELECT id, agent_id, status, started_at, ended_at, duration_seconds, source, break_code, break_name
    FROM agent_state_events
   WHERE status='On Break' AND started_at > now() - interval '24 hours'
   ORDER BY started_at DESC LIMIT 30;"
# 5b) Meeting present?  (empty result => report NOT AVAILABLE IN CURRENT LIVE DATA)
docker exec omni-postgres psql -U fs_cc_user -d fs_cc -c \
 "SELECT id, agent_id, break_code, break_name, source, started_at FROM agent_state_events
   WHERE status='On Break' AND break_code='MEETING' ORDER BY started_at DESC LIMIT 5;"
# 5c) Race check: adjacent same-agent segments (agent_self LUNCH vs fs_event NULL, same second)
docker exec omni-postgres psql -U fs_cc_user -d fs_cc -c \
 "SELECT id, agent_id, break_code, source, started_at, ended_at FROM agent_state_events
   WHERE status='On Break' ORDER BY agent_id, started_at DESC LIMIT 40;"

# 6) Current agents on break
docker exec omni-postgres psql -U fs_cc_user -d fs_cc -c \
 "SELECT agent_id, status, break_code, break_started_at FROM agents
   WHERE status='On Break' ORDER BY break_started_at DESC;"

# 7) agent-desk/me for a known agent on Lunch (needs that agent's Bearer token; do NOT paste the token)
#    Run ON the host because cc-backend is bound to 127.0.0.1:
curl -s -H "Authorization: Bearer <AGENT_JWT>" \
  http://127.0.0.1:${CC_BACKEND_PORT}/api/agent-desk/me | tr ',' '\n' | grep -Ei 'status|break_code|break_name'

# 8) Supervisor live-agents (supervisor token)
curl -s -H "Authorization: Bearer <SUP_JWT>" \
  http://127.0.0.1:${CC_BACKEND_PORT}/api/stats/live-agents | grep -Eio '"break_code":"[^"]*"|"break_name":"[^"]*"|"status":"On Break"' | head
```
> Replace `${CC_BACKEND_PORT}` with the value from `deploy/.env`. Do not paste JWTs/passwords back —
> the field names + values (`LUNCH`/`Lunch`/`null`) are all I need.
