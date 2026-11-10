# WebRTC Step 2: Transfer and Conference — Plan (for approval)

Date: 2026-11-09. Repository `Documents\fs-cc`, branch `main` at `603e8e62` (GitHub and Ubuntu-FS in sync).
Status: **PLAN ONLY. No code changed.** Each stage below needs the owner's approval.

## 1. What exists today (checked)

| Area | Finding |
|---|---|
| Phone engine (`features/softphone/engine`, sip.js 0.21.2) | One call at a time. Has dial, answer, reject, hang up, mute, hold (re-INVITE), DTMF, device selection. **No transfer, no second line.** sip.js itself supports SIP `REFER` (`session.refer()`), which is how a phone asks the server to transfer a call. |
| FreeSWITCH (Ubuntu-FS) | Standard dialplan: accepts SIP `REFER` from registered phones (MicroSIP transfer works the same way). Conference rooms already exist: dialling **3000–3099** joins a room (`conference.conf.xml`, profile `default`). `att_xfer` feature also present. |
| Backend / ESL | No transfer or conference API. Queue calls are bridged by mod_callcenter; a transfer by the agent's phone moves the customer leg out of the agent bridge — mod_callcenter then frees the agent. |
| Console UI | Transfer and Conference buttons are already on the console, disabled with "not available yet". |

## 2. Proposed approach — phone-side (no backend, no FreeSWITCH change)

All three features are done **by the browser phone using standard SIP**, exactly like a desk phone. Nothing is changed on the server, database or backend.

### Stage T1 — Blind transfer (smallest, most useful)
- Agent in a call presses **Transfer** → a small panel opens: number field + keypad + recent/extension pick → **Transfer now**.
- Engine: new `transfer(target)` → `session.refer(target)`; result shown ("Transferred to 1002" / "Transfer failed: busy / not found"). Call ends on success.
- Works for queue calls and direct calls.

### Stage T2 — Consult (attended) transfer
- **Consult** → customer is put on hold, a second call to the colleague is placed. Agent can talk, then:
  - **Complete transfer** (customer joined to colleague; agent drops) — SIP `REFER` with `Replaces`.
  - **Cancel** → hang up colleague, resume customer.
  - **Swap** between the two calls.
- Engine change: allow **two calls** (one held) — the main engine work in this programme. Existing one-call behaviour stays the default; 113 engine tests must still pass.

### Stage C1 — Conference (3-way)
- During a consult call, **Merge** → both calls moved into a fresh FreeSWITCH room (unused number in 3000–3099) using `REFER` of each leg to the room; agent joins too. Panel shows participants and **Leave** (others keep talking) / **End for all** (agent hangs up; room empties naturally).
- Limitation: no "kick one participant" or supervisor barge without a backend/ESL feature (separate, later approval).

### Stage D — Docs, tests, real-call checklist
- Unit tests for each new engine method and console panel; runbook section "Transfer and conference"; owner checklist.

## 3. What the agent will see

```
In call ─ [Mute] [Hold] [Transfer] [Conference]
Transfer ▸ ┌──────────────────────────────┐
           │ To: [ 1002          ] ⌫      │
           │ [Transfer now]  [Consult]    │
           └──────────────────────────────┘
Consulting ▸ Customer on hold 01:12 · Colleague 1002 00:20
           [Complete transfer] [Swap] [Merge (conference)] [Cancel]
```

## 4. Risks and checks

| Risk | Mitigation |
|---|---|
| mod_callcenter reporting after a transfer (call shown as handled by the agent, then ended) | Check in a real call; reporting is unchanged by this work, any gap documented. |
| Transfer target that does not answer → customer lost | Blind: FreeSWITCH behaviour (voicemail / hangup) — documented; recommend Consult for important calls. |
| Two calls in the browser confuse the call-matching (`correlate.js`) | Correlation keeps using the **customer** call; consult call shown only in the transfer panel. Tests added. |
| Conference room number clash | Room picked from agent extension (e.g. `30` + last 2 digits), documented; real fix would be a backend room allocator (later). |

## 5. Not in scope (need separate approval)
Supervisor monitor/whisper/barge, transfer to a **queue** by name (needs dialplan/backend), admin phone-type setting, wrap-up timer, call-quality figures, Docker images.

## 6. Order and approvals
1. Approve plan → **T1 blind transfer** (one local commit, tests, owner real-call test).
2. Approve → **T2 consult transfer**.
3. Approve → **C1 conference**.
4. Push only after owner approval, as before.

---

## 7. Stage T1 — Blind transfer: DONE (local commit, not pushed)

Approved 2026-11-10. Frontend only; no server, FreeSWITCH, backend or database change.

### What changed
| File | Change |
|---|---|
| `engine/src/types/phone.ts` | `CallInfo.transfer` (`target`, `status`: requesting / accepted / done / failed, `reason`) |
| `engine/src/services/call-state.ts` | `transfer` event (active calls only); `sipfragStatus()` reads REFER progress NOTIFYs |
| `engine/src/sip/sip-client.ts` | `makeTarget()` builds the transfer SIP URI |
| `engine/src/services/phone-service.ts` | `transfer(number)`: SIP REFER on the answered call. 202 → "Connecting…"; NOTIFY 200 → done, call ends "Transferred to X" (agent leg released after 2 s if FreeSWITCH did not already); 4xx/5xx → failed, customer stays on the call, error shown |
| `usePhone.js` | exposes `transfer` |
| `workspace/phone/PhoneConsole.jsx` | Transfer tile enabled in a call → panel "Transfer call to" + number field; the keypad types the transfer number (no DTMF while open); **Transfer now** / **Back to call**; live status line |

### How the agent uses it
1. Answer the call. 2. Press **Transfer**. 3. Type the extension or number (keypad or keyboard). 4. **Transfer now**.
- Success: "Transferred to 1002", the call leaves the console; the agent is free for the next call.
- Failure (busy, not found…): red message "Transfer failed: … Customer is still with you." — press **Back to call** or try another number.

### Verification
| Check | Result |
|---|---|
| Automated tests | **177 / 177** (8 new: 3 engine, 5 console) |
| Typecheck, build with phone on / off | clean ✓ / ✓ (sip.js only in the "on" build) |
| Real call (owner) | **pending**: queue call → transfer to an online extension; transfer to a busy / non-existent number; check the queue report afterwards |

### Known limitations
- Blind only: if the target does not answer, FreeSWITCH decides what happens (voicemail / hang up). Consult transfer is T2.
- Transfer while the customer is on hold works (FreeSWITCH takes the held leg).
