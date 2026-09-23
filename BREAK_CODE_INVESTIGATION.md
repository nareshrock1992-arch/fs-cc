# FS-CC Agent Break-Code Display — Investigation Report

> **Scope:** Investigation only. No application code, migration, DB record, API, UI, or service
> was modified. All references below are to code as it exists at the current working tree
> (fs-cc `main`). Where a fact cannot be established from the code alone, it is marked
> **NOT DETERMINED FROM CODE**.

---

## 1. Executive Summary

The reported symptom — "every screen shows just **Break** instead of the selected code (Lunch,
Meeting, …)" — is **not caused by a single point where the code is discarded**. Contrary to the
premise, the break code **is** captured, persisted, returned by the APIs, and rendered by most
UI screens. The code path for an **agent-initiated** break with an explicit code is essentially
complete end-to-end.

The screens that legitimately still show a bare **"Break"** do so for one of these concrete,
code-level reasons:

1. **Breaks that never carried a code in the first place.** Any status change that reaches the
   backend through the **FreeSWITCH ESL event path** (`eslService.js` → `handleStatusTransition(…, 'fs_event')`)
   or the **admin force-status path** (`agentsController.setAgentStatus`) is written to
   `agent_state_events` with `break_code = NULL` / `break_name = NULL`. This includes
   **automatic breaks** (the `queues.agent_no_answer_status = 'On Break'` behaviour from
   migration 008, where mod_callcenter puts a non-answering agent On Break). These rows have no
   code to show, so the UI's `break_name || break_code || 'Break'` fallback renders **"Break"**.

2. **One statistics/report path drops the columns.** `agentReportService.getBreakList()` — which
   feeds the per-agent report's `breaks.list` — does **not** `SELECT break_code / break_name`
   even though the columns exist on `agent_state_events`. Its aggregate `break_seconds` is a
   **single total across all codes**, with no per-code breakdown (explicit code comment:
   *"Break type … is not distinguished in Phase 1"*).

3. **The live `agents.break_code` column is only ever written by the agent-desk path.** The FS
   sync/echo path (`upsertAgentStatus`, `syncAgentStates`) and admin force never set it (admin
   explicitly sets `NULL`), so the Live Agents board's *current* break label can be blank for
   FS-driven or admin-driven breaks even when a historical code exists.

**If the customer is seeing "Break" on *every* screen for *agent-selected* breaks** (not just
automatic ones), the most likely remaining explanation is environmental rather than code-level —
either the deployed image predates the break-name rendering commits (`93041b2` "agent UI Break",
`9feb77c` "fs-cc agent live status"), or the `break_code` column is empty on the live rows. Which
of these is true on the running system is **NOT DETERMINED FROM CODE** (requires inspecting the
deployed build tag and the live `agent_state_events` / `agents` data, which is out of scope here).

---

## 2. Current Break-Code Flow (end to end)

```
Agent Desktop (StatusControls.jsx)
   └─ POST /api/agent/status { status:'On Break', break_code:'LUNCH' }
        └─ agentDeskController.agentSetStatus
             ├─ SELECT code,name FROM break_codes WHERE code=$1 AND active AND agent_selectable   (resolve+snapshot)
             ├─ UPDATE agents SET status, break_code, break_started_at
             ├─ INSERT agent_state_log (…, break_code)
             ├─ cc.agentSetStatus(agentId,'On Break')   ──► FreeSWITCH mod_callcenter
             └─ agentSessionService.handleStatusTransition(agentId,'On Break','agent_self',{break_code,break_name})
                    └─ openEvent(): INSERT agent_state_events (…, break_code, break_name)   ← SNAPSHOT stored

FreeSWITCH  ──(agent-status-change ESL event)──►  eslService.js case 'agent-status-change'
   ├─ upsertAgentStatus(agentId,status,null)          ← does NOT write break_code
   ├─ INSERT agent_state_log (agent_id,status,reason)  ← NO break_code
   ├─ handleStatusTransition(agentId,status,'fs_event')← NO breakInfo → break_code NULL
   └─ ccEvents.emit('agent:status',{agentId,status})   ← payload has NO break_code

Read paths:
   agentMe / agentBreakHistory  ─► agent-desktop  (return + render break_name)
   statsController live-agents   ─► LiveAgents.jsx (returns break_name; renders "· <name>")
   historyController.supervisorBreakHistory ─► admin BreakHistoryReport.jsx (returns+renders break_code/name)
   agentReportService.getAgentReport/getBreakList ─► per-agent report (drops break_code; total-only stats)
```

---

## 3. Current Data Model

**`break_codes`** (migration `007_break_management_and_call_direction.sql`) — configurable catalogue:
`id, code VARCHAR(64) UNIQUE, name VARCHAR(128), description, active, display_order, color, icon,
agent_selectable, max_duration_seconds, warn_threshold_seconds, created_by, updated_by,
created_at, updated_at`. Seeded: `COFFEE, LUNCH, MEETING, TRAINING, OTHER`.

**`agents`** (extended by 007) — live/current state:
`… status, break_code VARCHAR(64), break_started_at TIMESTAMPTZ …`. `status` still uses the
generic set (`Available | On Break | Logged Out`). `break_code` is the *current* code.

**`agent_state_events`** (extended by 007) — one row per contiguous status segment; **this is the
reporting source of truth for breaks**. Columns include `status`, `started_at`, `ended_at`,
`duration_seconds`, `source`, and the **snapshot** columns `break_code`, `break_name` (no FK to
`break_codes`, so a later rename/deactivate does not rewrite history — snapshot pattern).

**`agent_state_log`** (extended by 007) — append-only audit log; has `break_code` column, but it
is only populated by the agent-desk path (see §5), not the FS/admin paths.

The **desired model** the user described — keep `status = BREAK` (generic) **and** add
`break_code = LUNCH` alongside — **already matches the schema.** No schema change is required to
hold both. The gap is in *which write paths populate the code* and *which read paths surface it*.

---

## 4. Agent UI Flow

- **`agent-desktop/src/components/StatusControls.jsx`** — the three base statuses are separate
  from break codes; "On Break" is entered per-code: each configured code renders a button that
  calls `post('On Break', bc.code)` → `api.setStatus(status, breakCode)`. **A generic On-Break
  with no code is possible only if `breakCodes` is empty** (it then posts a plain On Break).
- **`agent-desktop/src/components/CurrentBreakPanel.jsx:48`** — renders
  `{breakName || breakCode || 'Break'}`. **Displays the real code name when present.**
- **`agent-desktop/src/components/BreakHistory.jsx:75`** — renders
  `{r.break_name || r.break_code || 'Break'}`, and offers a per-code filter dropdown (line 44).
  **Displays the real code name when present.**

**Verdict:** the Agent UI already shows the specific code *when the row carries one*. It shows
"Break" only when `break_name` and `break_code` are both null on that record.

---

## 5. Backend Flow (write)

- **`agentDeskController.agentSetStatus`** (agent-initiated): resolves the code against
  `break_codes` (`WHERE code=$1 AND active AND agent_selectable`), rejects invalid/inactive codes
  (400), then writes the code to `agents`, `agent_state_log`, and — via
  `handleStatusTransition(req.agentId, status, 'agent_self', {break_code, break_name})` — into
  `agent_state_events`. **Full code capture. ✓**
- **`agentSessionService.handleStatusTransition` → `openEvent`** (`agentSessionService.js:82-98`):
  `INSERT agent_state_events (…, break_code, break_name)` using
  `breakInfo?.break_code ?? null`. Snapshot is stored **only if the caller passed `breakInfo`.**
- **`eslService.js:764-776` (`case 'agent-status-change'`)**: the FreeSWITCH-driven path calls
  `handleStatusTransition(agentId, status, 'fs_event')` **with no `breakInfo`** →
  `break_code = NULL`. `upsertAgentStatus` (line 699) and `syncAgentStates` (line 624) update
  `agents.status`/`state` but **never `agents.break_code`**. `agent_state_log` insert (line 771)
  omits `break_code`. **Code loss #1 (by omission). ✗**
- **`agentsController.setAgentStatus` (admin force, line ~375)**: explicitly
  `SET break_code = NULL`, and calls `handleStatusTransition(agentId, status, 'manual')` with no
  `breakInfo`. **Admin-forced breaks carry no code by design. ✗ (intentional)**

**Race note (`agentSessionService.js:143-156`):** when the FS echo (`fs_event`, no code) and the
agent-desk call (`agent_self`, with code) both fire for the same On-Break segment, the dedup
logic is null-guarded — `breakInfo?.break_code && breakInfo.break_code !== open.break_code`. A
code-less echo will **not** overwrite an already-stored code, and a later coded call **will**
re-open the segment with the code. So the two do not clobber each other; ordering self-heals in
the agent-initiated case.

---

## 6. Database Flow (persistence)

- Agent-initiated On Break → `agent_state_events` row **with** `break_code`/`break_name`. ✓
- FS-initiated / automatic On Break (missed-call auto-away, or any mod_callcenter status change)
  → `agent_state_events` row **with `break_code = NULL`**. ✗
- Admin-forced On Break → `agent_state_events` row **with `break_code = NULL`**. ✗
- `agents.break_code` (current) is set **only** by the agent-desk path; cleared/never-set by FS
  and admin paths.

Whether the customer's live rows actually contain codes is **NOT DETERMINED FROM CODE**.

---

## 7. Agent History Flow

- API: **`agentDeskController.agentBreakHistory`** — `SELECT id, break_code, break_name,
  started_at, ended_at … FROM agent_state_events WHERE agent_id=$1 AND status='On Break'`
  (+ optional `break_code` filter), scoped to `req.agentId`. **Returns the code. ✓**
- UI: `BreakHistory.jsx:75` renders it. **✓** → shows "Break" only for null-code rows.

---

## 8. Supervisor UI Flow

- API: **`statsController` live-agents (~line 276-289)** — `SELECT … a.status, a.break_code,
  bc.name AS break_name, a.break_started_at … LEFT JOIN break_codes bc ON bc.code = a.break_code`.
  The derived `operational_state` label is the **generic** `'On Break'`, but `break_name` is a
  separate field in the payload. **Returns the code name. ✓**
- UI: **`frontend/src/pages/LiveAgents.jsx:275`** —
  `{r.operational_state === 'On Break' && r.break_name ? ` · ${r.break_name}` : ''}`.
  **Appends the code name when present. ✓** Because it keys off `agents.break_code` (via the join)
  and that column is only set on the agent-desk path, an FS/admin-initiated current break shows
  no suffix (just "On Break").
- Real-time: `ccEvents.emit('agent:status', {agentId, status})` (eslService.js:776) carries **no
  break_code**, but `LiveAgents` only uses it to `scheduleRefresh()` (re-fetch), so the label
  recovers from the API on refresh. **Not an independent display defect.**

---

## 9. Reports Flow

- **Admin Break History report** — `frontend/src/pages/reports/BreakHistoryReport.jsx` →
  `GET /reports/break-history` → **`historyController.supervisorBreakHistory`**, which
  `SELECT e.break_code, e.break_name … FROM agent_state_events` with a per-code filter. UI
  renders `{r.break_name || r.break_code || 'Break'}` (line 99). **Returns + renders the code. ✓**
- **Per-agent statistics report** — `agentReportService.getAgentReport` →
  - `getBreakList()` (`agentReportService.js:318`) **does NOT select `break_code`/`break_name`**
    (only `break_start, break_end, duration_seconds, source, is_open`). The `breaks.list` it
    produces has **no code** → any UI over it shows "Break". **✗**
  - Aggregate `break_seconds` = `stateDur.find(r => r.status === 'On Break')` → **single total,
    not per-code**. No per-code duration/count breakdown exists. **✗**

---

## 10. Root Cause

There is **no single line that "loses" the code**. The behaviour is the sum of three code-level
facts plus one possible environmental fact:

- **RC-1 (write, by omission):** the FreeSWITCH ESL path and the admin force path create On-Break
  segments with `break_code = NULL` (`eslService.js:774`, `agentsController.js:~377`). Automatic
  breaks (`agent_no_answer_status='On Break'`, migration 008) are inherently code-less here.
- **RC-2 (read/stats):** `agentReportService.getBreakList` omits the snapshot columns and the
  aggregate is total-only (`agentReportService.js:318-333`, `~504` comment).
- **RC-3 (live current column):** `agents.break_code` is written only by the agent-desk path;
  FS/admin never set it.
- **RC-4 (environment, unverified):** if agent-*selected* breaks also show "Break", the deployed
  build may predate `93041b2` / `9feb77c`, or the live rows may have null codes.
  **NOT DETERMINED FROM CODE.**

---

## 11. Why Every Screen Shows "Break" (per-screen classification)

| Screen | API carries code? | UI renders code? | Shows "Break" when… |
|---|---|---|---|
| Agent Desktop — current break (`CurrentBreakPanel`) | Yes (`agentMe`) | Yes | `break_code` null on `agents` (FS/admin break, or agent posted no code) |
| Agent Desktop — break history (`BreakHistory`) | Yes (`agentBreakHistory`) | Yes | segment row `break_code` null (RC-1) |
| Supervisor Live board (`LiveAgents`) | Yes (`live-agents`) | Yes ("· name") | `agents.break_code` null (RC-3) — FS/admin current break |
| Admin Break History report (`BreakHistoryReport`) | Yes (`supervisorBreakHistory`) | Yes | segment row `break_code` null (RC-1) |
| Per-agent statistics report (`getAgentReport.breaks.list`) | **No** (RC-2) | n/a | **always** (columns not selected) |
| Break statistics / dashboards (per-code totals) | **No** (RC-2) | n/a | **always** (no per-code aggregation exists) |

So: the **history/live/agent screens** show "Break" only for **code-less rows** (RC-1/RC-3); the
**statistics/aggregate screens** show "Break" (or no breakdown) **always** (RC-2).

---

## 12. Recommended Architecture

Keep the existing dual model (generic `status='On Break'` **plus** `break_code`), which the schema
already supports. Close the gaps rather than redesign:

1. **Populate the code on every write path**, including FS-initiated and automatic breaks, using a
   reserved system code (e.g. `AUTO` / `SYSTEM`) rather than NULL, so "no explicit code" is a
   *value*, not an *absence*. Preserve NULL for genuinely-historical rows (do not backfill old
   data — see §17).
2. **Carry the code through `getBreakList` and add a per-code aggregation** so statistics stop
   collapsing to a single total.
3. **Set `agents.break_code`** on the FS/admin current-state writes so the Live board's current
   label matches history.
4. **Add `break_code` to the socket `agent:status`/`agent:state` payloads** so live updates carry
   the code without a full refetch (optional; refetch already covers correctness).

This preserves every existing query that keys on `status='On Break'` (statistics that count/sum by
status are untouched), satisfying the "must not break existing statistics" constraint.

---

## 13. Files To Modify (proposed — not modified in this investigation)

- `backend/services/agentReportService.js` — `getBreakList` SELECT + per-code aggregation in
  `getAgentReport`.
- `backend/services/eslService.js` — `case 'agent-status-change'` / `case 'agent-state-change'`:
  pass a `breakInfo` (reserved system code) to `handleStatusTransition`; set `agents.break_code`
  in `upsertAgentStatus`; add `break_code` to the `agent_state_log` insert and to the
  `ccEvents.emit` payloads.
- `backend/controllers/agentsController.js` — `setAgentStatus`: set a reserved code instead of
  `NULL` for admin-forced On Break (decision point; may intentionally stay uncoded).
- `backend/controllers/statsController.js` — optional: expose per-code label on the live payload
  even for FS/admin breaks once `agents.break_code` is populated.
- `frontend/src/pages/reports/…` and any statistics/dashboard component — add per-code
  breakdown display (currently total-only). Exact component for "break statistics dashboard":
  **NOT DETERMINED FROM CODE** (no dedicated per-code stats component was found; only
  `BreakHistoryReport.jsx` and the per-agent report exist).
- `frontend/src/api/client.js` — only if new fields/endpoints are added.

No change is required to `CurrentBreakPanel.jsx`, `BreakHistory.jsx`, `LiveAgents.jsx`, or
`BreakHistoryReport.jsx` — they already render the code when present.

---

## 14. DB Changes

**None required for the dual model** — `break_code`/`break_name` already exist on
`agent_state_events`, `agent_state_log`, and `agents`. Optional additive migration only if a
reserved system code row (`AUTO`/`SYSTEM`, `agent_selectable=false`) is seeded into `break_codes`.
No column drops, no type changes, no rewrite of existing rows.

---

## 15. API Changes

- Additive only: `getBreakList`/`getAgentReport` responses gain `break_code`/`break_name` per
  segment and a per-code aggregate array. Existing fields (`break_seconds` total) remain for
  backward compatibility.
- Optional: `agent:status`/`agent:state` socket payloads gain `break_code`/`break_name`.
- `agentMe`, `agentBreakHistory`, `live-agents`, `supervisorBreakHistory` — **no change needed**.

## 16. UI Changes

- Add per-code breakdown to the statistics/report view(s) consuming `getAgentReport.breaks`.
- No change to the four screens already rendering the code.

## 17. Backward Compatibility

- Existing `status='On Break'` statistics are untouched (dual model). ✓
- **Do not invent codes for old historical rows** — pre-change rows keep `break_code = NULL` and
  continue to render "Break". New rows get a code (explicit or reserved system code). This gives a
  clean historical/new boundary keyed on whether `break_code IS NULL`. ✓
- Migration 008 automatic-break behaviour keeps working; those rows simply gain a reserved code
  going forward instead of NULL.

## 18. Risks

- **R1:** Introducing a reserved system code via the FS path must not overwrite an agent's
  explicit code (the dedup in `handleStatusTransition` already guards this, but the new
  `breakInfo` must preserve that guard — pass the reserved code only when no code is already open).
- **R2:** Per-code aggregation must exclude/segregate the reserved system code so "voluntary"
  break stats aren't skewed by automatic breaks.
- **R3:** If the real customer symptom is an **older deployed build** (RC-4), code changes here
  will not fix the running system until redeployed — verify the deployed image first.

## 19. Implementation Plan (phased)

- **Phase A — Verify environment (blocking, no code):** confirm the deployed image contains
  commits `93041b2`/`9feb77c`; sample live `agent_state_events`/`agents` to see whether
  `break_code` is populated for agent-selected breaks. This decides whether any code change is
  even needed for the "agent-selected shows Break" case.
- **Phase B — Statistics (RC-2):** add `break_code`/`break_name` to `getBreakList`; add a per-code
  aggregate to `getAgentReport`; surface it in the report UI. Lowest risk, highest visible payoff.
- **Phase C — Write-path completeness (RC-1/RC-3):** seed a reserved system code; set it (and
  `agents.break_code`) on the FS and admin paths; add `break_code` to `agent_state_log` and the
  socket payloads.
- **Phase D — Live payload (optional):** carry `break_code` in `agent:status`/`agent:state`.

## 20. Test Plan

- Unit (vitest): extend `backend/src/__tests__/unit/agentDeskBreak.test.js` and add coverage for
  (a) FS `agent-status-change` writing the reserved code, (b) `getBreakList` returning the
  columns, (c) per-code aggregation excluding the system code, (d) dedup guard not overwriting an
  explicit code with the system code.
- Integration/DEV gate: agent selects each code → verify code on `agents`, `agent_state_events`,
  agent history, live board, break-history report, per-agent stats; trigger an automatic
  no-answer break → verify reserved code (not NULL, not a fake voluntary code); admin force → per
  the §13 decision.
- Regression: existing `status='On Break'` counts/sums unchanged; old NULL-code rows still show
  "Break".

## 21. Acceptance Criteria

1. Agent-selected breaks show the specific code on Agent UI (current + history), Supervisor Live
   board, Admin Break History report, **and** per-agent statistics. ✓
2. Automatic/FS/admin breaks show a distinguishable reserved label (not a fabricated voluntary
   code, not a bare "Break"). ✓
3. Per-code break statistics/totals exist (not a single lumped total). ✓
4. Existing status-based statistics are unchanged. ✓
5. Historical (pre-change) rows are not backfilled and still render "Break". ✓

---

### Appendix — Key evidence locations

- Snapshot columns created: `backend/db/migrations/007_break_management_and_call_direction.sql`
- Snapshot write: `backend/services/agentSessionService.js:82-98`
- FS path (code-less): `backend/services/eslService.js:764-776`, `:699-712`, `:624-631`
- Admin force (code=NULL): `backend/controllers/agentsController.js:~375-387`
- Stats gap: `backend/services/agentReportService.js:318-333`, aggregate `~373-499`
- Read paths that DO carry the code: `agentDeskController.agentMe` / `agentBreakHistory`,
  `statsController` live-agents, `historyController.supervisorBreakHistory`
- UI that DOES render the code: `agent-desktop/src/components/CurrentBreakPanel.jsx:48`,
  `BreakHistory.jsx:75`, `frontend/src/pages/LiveAgents.jsx:275`,
  `frontend/src/pages/reports/BreakHistoryReport.jsx:99`
