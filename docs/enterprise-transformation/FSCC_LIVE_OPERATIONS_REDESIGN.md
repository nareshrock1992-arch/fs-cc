# Live Operations — Analysis and Redesign Proposal

Inputs: owner screenshot of the current page (DEV, 2026-11-14) and the target mockup. Mockup numbers are illustrative only; every value below is mapped to a real FS-CC source.

## 1. What the current page does well (keep)
- Real-time: refreshes on ESL socket events (enqueue, bridge, hangup, agent state), not polling.
- Correct separation of **IVR & Pre-Queue** callers from callers already in a FreeSWITCH queue.
- Agent states from mod_callcenter (business state), not SIP registration.
- Filter chips, search, queue filter, sort, supervisor "Set…" action.

## 2. Problems in the current page
| # | Problem | Effect |
|---|---|---|
| P1 | **SLA uses the queue's *maximum wait* as its target** (`LiveOperations.jsx:544`, `statsController` `sla_pct`). After OPS-1 set max wait to 0 (= no limit), every waiting call is "Breached" at once and today's SLA % ≈ 0. | Wrong numbers. **Bug, fix first.** |
| P2 | 8 equal KPI tiles; 3 queue tiles + 5 agent tiles have the same weight. "0 / 0 / 0" dominates the screen. | Health not readable at a glance. |
| P3 | No per-queue view: a supervisor cannot see *which* queue is in trouble. | Must open Queue Stats. |
| P4 | No trend (is it getting worse?) and no alerts list. | Reactive supervision. |
| P5 | Calls Requiring Attention lists normal on-call calls (1 row = an ordinary call). | Noise; real attention items get lost. |
| P6 | Agent Floor: "Current Call" and "Call Dur" mostly "—"; queue names truncated ("CompCommun"). | Wasted width. |
| P7 | Pre-queue "Eligibility / Target Queue: Not reported" in every row. | Columns with no data. |
| P8 | Long single column; page scrolls before the agent floor is visible. | Poor use of a wide screen. |

## 3. Proposed layout (wide screen; stacks on narrow)
```
┌ Header: Live Operations · Live/updated · [Today ▾] ─────────────────────────────┐
│ Health strip (one row, compact):                                                 │
│ Waiting 3 · Longest 02:14 · Avg wait today 0:18 · Service level 92% (target 20s) │
│ · Abandoned today 4 · Agents 5 (2 avail · 2 on call · 1 break) · Active calls 2  │
├──────────────────────────────────────────────┬───────────────────────────────────┤
│ Queue performance (one row per queue)        │ Alerts (only real conditions)     │
│ Queue · Waiting · Longest · SL% today ·      │ • Caller waiting > SL target      │
│ Avail/Logged-in agents · Health ●            │ • Queue with callers, 0 available │
│                                              │ • FreeSWITCH (ESL) disconnected   │
│                                              │ • Agent no-answer (last 15 min)   │
├──────────────────────────────────────────────┼───────────────────────────────────┤
│ Calls today by hour (offered / answered /    │ Agent overview: donut by state    │
│ abandoned, from queue_stats_hourly)          │ (Available, On call, Ringing,     │
│                                              │  Break, Offline)                  │
├──────────────────────────────────────────────┴───────────────────────────────────┤
│ IVR & Pre-Queue (collapsible; only columns that have data)                      │
├──────────────────────────────────────────────┬───────────────────────────────────┤
│ Calls requiring attention: ONLY waiting      │ Agent floor: agent · ext · state  │
│ over target, ringing/no-answer, long hold,   │ · time in state · current call ·  │
│ with actions (listen = later, SUP-1)         │ queues (chips) · action           │
└──────────────────────────────────────────────┴───────────────────────────────────┘
```

## 4. Data mapping (no new invented values)
| Element | Source | Status |
|---|---|---|
| Waiting, longest wait, active calls | `/calls/live` + socket | exists |
| Avg wait today, abandoned today, SL % per queue | `/stats/queues` (`avg_wait_today`, `sla_pct_today`) | exists, **SL target wrong (P1)** |
| Hourly trend | `/stats/calls-trend` (`queue_stats_hourly`) | exists |
| Agent states, time in state | `/stats/live-agents` + socket | exists |
| Pre-queue | `/calls/prequeue` + socket | exists |
| Alerts | derived in the page from the above (no new backend) | new UI only |
| Listen / whisper / barge actions | SUP-1 | not built (owner decisions pending) |

## 5. Decision needed — service level target (fixes P1)
Add a separate **service level target (seconds)** per queue, default **20 s** (industry common 80/20), editable on the Queues page. Max wait stays a routing setting only.
- Backend: new column `queues.sla_seconds` (migration, default 20), used by the SLA formulas instead of `max_wait_time`. Backward compatible.
- Formula kept as today: answered within target ÷ (answered + abandoned).

## 6. Order of work
1. P1 fix (SL target) — needs owner OK on 20 s default.
2. Live Operations layout (sections 3–4), screenshots, tests.
3. Design system + shell, then other pages (UI brief).
