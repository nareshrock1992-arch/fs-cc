# Agent Desktop — Redesign Plan (for approval)

Based on the owner's screenshot (DEV, 1280-wide browser) and the current code (`agent-desktop/src/workspace/*`, `shell/*`). Data sources stay the same: `/agent-desk/*` APIs, the agent socket room, and the browser phone engine. No backend or FreeSWITCH change.

## 1. What works today (keep)
- Three areas: phone · interaction · context (customer + my queues); left rail (Workspace, Queues, Calls, Breaks).
- Call matching between the queue event and the browser phone (`correlate`), consult / transfer / conference controls, status selector with break codes, recent calls with click-to-dial.

## 2. Problems
| # | Problem | Effect |
|---|---|---|
| A1 | The dial pad (12 large keys) fills the left column all the time | The most-used area shows the least-used control; customer info is pushed to the edge |
| A2 | Right column is clipped at common laptop widths ("0 waitin…", "during a ca…") | Text cut off |
| A3 | Queue names in the header truncated ("RadioPA…") and repeated in "My queues" | Noise |
| A4 | Idle state is just "Waiting for the next interaction" | No useful information while waiting (queue load, own day) |
| A5 | Today's figures are a thin strip low on the page | Agents don't see their own performance |
| A6 | Recent calls show 2:10:59 for the stuck call (BUG-007 data) | Misleading history (data already fixed going forward) |

## 3. Proposed layout
```
┌ Header: Agent Desktop · ● Healthy · [Available ▾] · name/ext ─────────────────────┐
├ rail ┬─────────────────────────────────────────────┬─────────────────────────────┤
│      │ CURRENT INTERACTION (the main area)          │ Customer                    │
│      │  Idle:  "Ready for calls"                    │  number / name, previous    │
│      │         queues waiting now · my day (4 KPIs) │  calls with this number     │
│      │  Ringing / on call: caller, queue, timer,    ├─────────────────────────────┤
│      │  Answer · Hold · Mute · Transfer · Conference│ My queues                   │
│      │  · End  (one control bar)                    │  name · waiting · longest   │
│      ├──────────────────────────────────────────────┤  · agents available         │
│      │ Dial: [number field] [Call] [⌨ keypad]       │  (no truncation; wraps)     │
│      │  keypad opens on demand / during call (DTMF) │                             │
│      ├──────────────────────────────────────────────┤                             │
│      │ Recent calls (compact table, click to dial)  │                             │
└──────┴──────────────────────────────────────────────┴─────────────────────────────┘
```
- One control bar for the call, always in the same place (no jumping buttons).
- Dial pad collapses to a number field + Call; keypad opens on click and automatically for in-call tones.
- Right column min width so nothing is clipped; below 1280 px it moves under the main area (already supported).
- Same design tokens, tables and status colours as the admin portal (FSCC_ENTERPRISE_DESIGN_SYSTEM.md).

## 4. Steps
1. Layout + collapsible dial pad + call control bar (no behaviour change; existing phone tests must pass).
2. Idle "Ready" panel: queues waiting + my day KPIs (from existing `/agent-desk/queues`, `/agent-desk/performance`).
3. Right column: customer with previous calls, my queues table (no truncation).
4. Visual check: owner signs in to a preview with an agent account; screenshots at 1280 / 1440 / 1920 and phone width.

## 5. Owner input
- Approve the layout above (or mark changes).
- For the visual check, sign in once in the preview with a test agent.

## 6. Step 1 — done (2026-11-14), not deployed
- Keypad folds away (Keypad / Hide keypad toggle); keyboard digits still send DTMF in a call.
- Phone column 18–22 rem; main area up to 100 rem wide (was 72 rem, large empty margins at 1920 px).
- Right column w-72 (w-80 at 2xl), no horizontal clipping; queue names wrap.
- Pre-existing bug fixed: on phones the phone card was 416 px in a 375 px screen (grid had no small-screen column).
- Preview checked (agent signed in by owner, phone enabled with VITE_WEBRTC_ENABLED only): 1335, 1920, 375 px — no page overflow. Phone sign-in not possible in the preview (no HTTPS / SIP domain), so calls not exercised.
- Tests 196/196, typecheck ✓, build ✓.

## 7. Step 2 — done (2026-11-15), not deployed
- Idle panel title "Ready for calls" (or "You are <status>").
- "My queues now": total waiting, longest wait (— when nobody waits), agents free — from the existing 3-s `/agent-desk/queues` poll.
- "My day": handled, missed, avg talk — from `/agent-desk/performance`.
- Blocks are hidden when there is no data (no fake zeros). The one-line "Today" strip now shows only during a call.
- Tests 198/198 (2 new), typecheck ✓, build ✓. Not yet checked in a signed-in preview.

## 8. Step 3 — done (2026-11-15), not deployed
- My queues is now a table: Queue · Wait · Longest (— when nobody waits) · Free (red when 0). Names wrap, never cut.
- Customer: a "N recent · M missed" line above this agent's previous calls with the number (date and time per call).
- No new API; same 3-s queue poll and call-history search.
- Tests 199/199, typecheck ✓, build ✓. Not yet checked in a signed-in preview.
