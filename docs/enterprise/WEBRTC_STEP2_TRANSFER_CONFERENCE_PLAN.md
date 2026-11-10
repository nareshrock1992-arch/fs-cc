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
| Real call (owner, 2026-11-10) | ✓ transfer to an internal extension; ✓ transfer to an IVR flow number. Not yet tried: busy / non-existent target, queue report check |

### Known limitations
- Blind only: if the target does not answer, FreeSWITCH decides what happens (voicemail / hang up). Consult transfer is T2.
- Transfer while the customer is on hold works (FreeSWITCH takes the held leg).

---

## 8. Stage T2: Consult (attended) transfer — DONE (local commit, not pushed)

Approved 2026-11-10. Frontend only; no server, FreeSWITCH, backend or database change.

### What changed
| File | Change |
|---|---|
| `engine/src/types/phone.ts` | `PhoneState.consult` (second line: target, status, held, completing) |
| `engine/src/services/call-state.ts` | `promoteConsult()` |
| `engine/src/services/phone-service.ts` | second line: `startConsult(number)` (customer put on hold, colleague called), `swapCalls()`, `cancelConsult()` (colleague hung up, customer resumed), `completeConsult()` (SIP REFER with Replaces on the customer call; FreeSWITCH joins customer and colleague; agent released). Customer hangs up during consult → colleague call becomes the main call. Colleague hangs up → customer stays on hold with a "press Resume" notice. Logout ends both. |
| `usePhone.js` | exposes the four consult actions |
| `workspace/phone/PhoneConsole.jsx` | Transfer panel gets **Consult first**. While consulting: card with Customer (on hold / talking) and Colleague (ringing / talking + timer / on hold / transferring); buttons **Complete transfer**, **Talk to customer / Talk to colleague**, **Cancel consult**; keypad, mute, hold and End call disabled |

Call matching (`correlate.js`) is unchanged: it only uses the customer call, so the colleague call is never shown as the queue call (tested).

### How the agent uses it
1. In a call press **Transfer**, type the colleague's number, press **Consult first**. The customer hears hold music.
2. When the colleague answers, explain the call. **Talk to customer** / **Talk to colleague** switch between them.
3. **Complete transfer**: customer and colleague are connected; the agent is free. Or **Cancel consult**: the colleague is hung up and the customer is back with you.

### Verification
| Check | Result |
|---|---|
| Automated tests | **185 / 185** (8 new: 2 engine, 6 console) |
| Typecheck, build with phone on / off | clean ✓ / ✓ |
| Real call (owner) | **pending**: consult → complete; consult → cancel; swap both ways; colleague does not answer; customer hangs up during consult |

### Known limitations
- Microphone change and DTMF apply to the customer call only (not the consult line).
- Incoming calls while consulting get "busy" (one agent, two lines max).
- If the colleague is an IVR or queue, Complete transfer depends on FreeSWITCH accepting REFER/Replaces for that leg; Cancel always works.
