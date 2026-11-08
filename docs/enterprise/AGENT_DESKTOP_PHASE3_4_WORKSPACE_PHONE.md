# Agent Desktop redesign, Phases 3–4: interaction workspace, customer context, telephony

Date: 2026-11-08. Status: **implemented; automated tests and builds pass; committed locally, not pushed; real FreeSWITCH/WebRTC verification pending (owner).**

Phases 3 and 4 were delivered together: "one authoritative interaction" (Phase 3) is only possible when the phone controls (Phase 4) live inside that interaction card. Keeping the old phone panel during Phase 3 would have shown every browser call twice.

## 1. Owner feedback addressed (Phase 2 screenshot, 1366 × 768)

| Seen | Change |
|---|---|
| Dial pad occupied the whole workspace | Idle workspace = one input row + **Call**; keypad hidden, opens as a small 3×4 popover (184 px wide) |
| Phone card first, call area pushed down | Centre column now shows the **interaction** (idle → incoming → active → ended); phone sign-in/devices moved to the context panel |
| Large performance cards on the working screen | One-line **Today** strip; full performance cards moved to the Queues page |

## 2. Layout

```
Top bar: queues · Server ● Live ● FreeSWITCH ● Phone ● · agent/ext · [status ▾] · theme · sign out
┌rail┐┌ centre ───────────────────────────────┐┌ context (≥1280 px; below it, under the workspace) ┐
│Work││ [Not reachable banner, if applicable]  ││ Browser phone: status, ext, sign in/out, devices   │
│Queu││ [sync warning, if applicable]          ││ Customer: number, name, direction, queue, ID,      │
│Call││ Interaction card (one):                ││           your previous calls with this number     │
│Brk ││  idle    : "Waiting…" + dialer + recent││ My queues: waiting / available per queue           │
│    ││  incoming: number, name, queue, ring   ││                                                     │
│    ││            timer, Answer / Reject      ││                                                     │
│    ││  calling : destination, progress,Cancel││                                                     │
│    ││  active  : timer, Mute Hold Keypad     ││                                                     │
│    ││            Transfer* Conference* | End ││                                                     │
│    ││  ended   : result + reason + duration  ││                                                     │
│    ││ Break panel (on break) · Today strip   ││                                                     │
└────┘└────────────────────────────────────────┘└─────────────────────────────────────────────────────┘
* disabled, labelled "not available yet"
```

Incoming and active calls are also shown on the Queues, Calls and Breaks pages, so a call is never hidden by navigation.

## 3. Correlation strategy (ESL queue call ↔ browser SIP call)

No shared identifier exists (sip.js session id ≠ FreeSWITCH call_uuid; none is invented). `src/interactions/correlate.js` links the two **only if all hold**:

1. the ESL call is offered to **this agent** (agent-scoped socket room / poll);
2. the browser phone is **registered** for this agent;
3. the SIP call is **inbound** (mod_callcenter calls the agent);
4. both are **live at the same time** (engine allows one call);
5. numbers are **not conflicting** (equal, suffix after dropping trunk zeros, or one side unknown).

A matching number alone never links. Outcomes:

| Situation | Shown |
|---|---|
| linked | one card with queue, caller name, call_uuid + browser controls |
| browser call only | one card (direct or outbound call) |
| queue offer, browser not yet ringing (event timing gap) | card "Offered by queue" + "waiting for it to ring in the browser phone"; no Answer button |
| queue call talking, no browser call | "Connected (other device)"; no controls |
| both present but a condition fails | browser call card **plus** a separate queue-call strip and a warning "could not be confirmed as the same call" |

## 4. Telephony states

| State | Content | Controls |
|---|---|---|
| Idle | readiness text from agent status; dialer disabled with the real reason (phone off, not signed in, not registered, not eligible) | Call (double-click safe), keypad popover, recent-number chips |
| Outbound | destination, "Calling…/Ringing…/Connecting…" | Cancel |
| Incoming | 2-px amber border, number, caller name, queue, ringing timer | Answer (green), Reject (red) |
| Active | call duration, badges (status, call type, queue, Muted) | Mute, Hold/Resume, Keypad (DTMF, tones sent), Transfer\*, Conference\*, End call (red, right-aligned) |
| Ended | "Call ended"/"Call not connected" + engine reason + duration; engine clears it after a few seconds | — |

No confirmation on End call (one click, as in commercial desktops; it is separated from other controls instead).

## 5. Agent status and connectivity

Unchanged settable statuses (Available, On Break, Logged Out). **Not reachable** banner (red) when the agent is Available and the browser phone is enabled and eligible but not registered. Four separate lamps (Phase 2) now take the phone state from the same live phone object.

## 6. Files

| File | Change |
|---|---|
| `src/interactions/correlate.js` | new — correlation rules |
| `src/workspace/InteractionWorkspace.jsx` | new — idle / incoming / active / ended views |
| `src/workspace/Dialer.jsx`, `Keypad.jsx` | new — compact dialer and keypad |
| `src/workspace/PhoneCard.jsx` | new — registration, password-only sign-in (memory only), devices, audio unlock, errors |
| `src/workspace/ContextPanels.jsx` | new — Customer panel, Queue summary, Today strip, Not-reachable banner |
| `src/workspace/format.js` | new — duration/elapsed helpers |
| `src/features/softphone/ui/PhoneBridge.jsx` | new — passes `usePhone()` to the desk (lazy; WebRTC builds only) |
| `src/pages/Dashboard.jsx` | render rewritten around the new components; **all fetching, polling, socket handlers, status/break/logout logic unchanged**; adds recent-numbers fetch from existing call-history API |
| `src/components/LiveCallPanel.jsx` | removed — replaced by the interaction card |
| `src/features/softphone/ui/PhoneStatusProbe.jsx` | removed (Phase 2 helper, superseded by PhoneBridge) |
| `vitest.config.js` | includes new test folders |
| tests | `interactions/__tests__/correlate.test.js` (12), `workspace/__tests__/workspace.test.js` (18) |

`SoftphonePanel.jsx` (Step 1) is kept with its tests but no longer mounted.

## 7. Protection

Not changed: softphone engine, PhoneProvider, usePhone, adapters, backend, DB, FreeSWITCH, ESL, mod_callcenter, API client, socket, auth, polling intervals, status values, `.env*`, FS-ENRS, FS-WebRTC.

## 8. Verification

| Type | Status |
|---|---|
| Automated tests | **152 / 152 passed** (11 files) |
| Typecheck | clean |
| Build (phone on / off) | both OK; sip.js only in the "on" build |
| Browser visual check | **pending** — owner screenshots |
| Real FreeSWITCH/WebRTC | **pending** — owner test with 1000/1001 and a queue call |
| Transfer, conference | not available (need engine/back-end work, separate approval) |

## 9. Known limitations

- Correlation is rule-based (no shared id); unusual cases show the unlinked warning instead of merging.
- Previous-calls list shows **queue** calls of this agent only (direct extension calls are not in agent history).
- "Not reachable" cannot know about a desk phone on the same extension (planned per-agent phone type, admin setting).
- Keyboard shortcuts for answer/hold/end: not yet (Phase 5 candidate).
- Context panel shows at ≥ 1280 px; below that it is placed under the workspace.

## 10. Fixes from the owner's preview test (2026-11-08, port 8095)

| Seen | Cause | Fix (frontend only) |
|---|---|---|
| Own extension `1000` offered as a recent number | history rows include the agent's own extension | excluded from quick-dial chips |
| Incoming shown as `1001 <1001>` | engine identity format `Name <number>` was not parsed | `sipParty()` extracts number and (different) display name |
| Queue call while ringing shown as "Direct call", no queue | **pre-existing**: `/agent-desk/calls` filters `calls.agent_id`, set only after answer, so the 3-s poll cleared the `agent:offering` state at once | ringing state from `agent:offering` is kept (max 120 s) until answer, `agent:no-answer`, `call:abandoned` or `channel:hangup` for that uuid; number, caller name and queue are filled from the existing agent-scoped `GET /agent-desk/call-history/:uuid` (row written before the event) |

Tests: 154 / 154.
