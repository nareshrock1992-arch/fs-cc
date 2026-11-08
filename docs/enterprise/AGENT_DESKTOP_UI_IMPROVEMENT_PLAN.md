# Agent Desktop: enterprise telephony UI improvement plan (Phase 0 + Phase 1)

Date: 2026-11-08. Status: **proposal for approval — no application code changed for this plan.**

## 0. Phase 0 — verified state

| Item | Value |
|---|---|
| Repository | `C:\Users\naresh\Documents\fs-cc` (authoritative CC source per `CLAUDE.md`; no separate GOVERNANCE/security file in this repo — governance lives in `fs-enrs/GOVERNANCE.md`) |
| Branch / HEAD | `main` / `a4a294e9` |
| Working tree | clean, no untracked files |
| Local commits not on GitHub | 3: `27534810` (Phases 3–4 workspace), `0d74b9da` (queue-offer fix), `a4a294e9` (previous-calls fix) |
| GitHub `origin/main` and Ubuntu-FS | `4359507a` (Phase 2 shell) |
| Temporary preview | `https://192.168.1.124:8095` (throwaway copy in `/root/test`, runs the laptop code) |
| Draft code | a console draft written before this brief arrived was **removed from the repo** and kept only as a reference outside it |

Documents read: `CLAUDE.md`, `AGENT_DESKTOP_CURRENT_STATE_AUDIT.md`, `AGENT_DESKTOP_REDESIGN_BLUEPRINT.md`, Phase 2 and Phase 3–4 reports.

Existing telephony building blocks (all kept): sip.js engine → `PhoneService` → `PhoneProvider`/`usePhone` → `PhoneBridge` (hands `usePhone()` to the desk) → `correlate.js` (one interaction from ESL + SIP, verified rules) → workspace components.

## 1. Problems in the current preview (owner review)

1. Keypad hidden behind an icon; agent types numbers by hand.
2. Phone squeezed into the right panel (registration, sign-in, devices) — not a first-class workspace.
3. Call controls are a row of small buttons inside a card.
4. Large empty area below the call card.
5. Phone state, microphone, speaker and call duration are not visible together.

## 2. Proposed layout (1366 × 768 reference)

```
┌ top bar 56px ────────────────────────────────────────────────────────────────────────────────────┐
│ [FS-CC] Agent Desktop · Queues: Sales, Support…   ●Server ●Live ●FreeSWITCH ●Phone   Sunday     │
│                                                                         Ext 1000 [● Available ▾] ☾ ⎋ │
├──┬───────────────────────────────────────────────────────────────┬────────────────────────────────┤
│  │ [Not reachable banner — only when Available + phone not registered]          │ CUSTOMER     │
│R │ ┌ PHONE  ● Phone ready · Ext 1000 ──────────┐ ┌ CALL / ACTIVITY ───────────┐ │ Number       │
│A │ │      ┌──────────────────────────┐ ⌫ ✕     │ │ idle: Recent calls (real   │ │ Caller name  │
│I │ │      │  0501234567              │         │ │   history) — click to load │ │ Dialled no.  │
│L │ │      └──────────────────────────┘         │ │   into the keypad          │ │ Queue        │
│  │ │   [ 1 ] [ 2 ] [ 3 ]                       │ │ ringing: incoming card     │ │ Duration     │
│72│ │   [ 4 ] [ 5 ] [ 6 ]     keypad 3×4,       │ │   (number, name, queue,    │ │ Interaction  │
│px│ │   [ 7 ] [ 8 ] [ 9 ]     56px keys,        │ │   ring timer, Answer/Reject│ │ ─────────── │
│  │ │   [ * ] [ 0 ] [ # ]     always visible    │ │ in call: call summary,     │ │ Previous     │
│  │ │   [        ☎  Call         ]               │ │   state timeline, tones    │ │ calls (5)    │
│  │ │  ─────────────────────────                 │ │ after call: result +       │ │ ─────────── │
│  │ │  [Mute] [Hold] [Transfer*] [Conference*]   │ │   wrap-up note             │ │ MY QUEUES    │
│  │ │  🎤 Headset mic ▾   🎧 Headset speaker ▾   │ │ Today: 4 handled · 4 missed│ │ waiting/avail│
│  │ └───────────────────────────────────────────┘ └────────────────────────────┘ │              │
└──┴───────────────────────────────────────────────────────────────┴────────────────────────────────┘
   centre = telephony workspace (~600px phone + ~330px call/activity)         right = 320px
```

Width at 1366: rail 72 + phone 420 + call/activity ≈ 540 + context 320 (+ gutters). Height fits 768 with no page scroll: top bar 56, phone ≈ 610.

### Phone (centre-left, always on the Workspace page; collapsed strip on other pages)

| State | Display area | Keypad | Main action | Controls row |
|---|---|---|---|---|
| Not signed in | "Sign in to extension 1000" + password field + Sign in (memory only) | shown, disabled | — | disabled |
| Registering / failed | lamp + reason (connecting, sign-in failed, reconnecting) | disabled | — | disabled |
| Idle (registered) | large number field (28 px mono), ⌫ backspace, ✕ clear; typing and paste allowed (non-dial characters removed) | **enabled: dials** | green **Call** (full width; blocked while placing) | disabled |
| Outgoing | number, "Calling…/Ringing…/Connecting…" | disabled | red **Cancel call** | disabled |
| Incoming | number, caller name, queue, ringing timer, pulsing amber badge | disabled | green **Answer** + red **Reject** (equal halves) | disabled |
| In call | number, name, queue, "Connected"/"On hold", **duration timer** | **enabled: sends DTMF** (also physical keyboard 0–9 * #), "Tones: 123#" | red **End call** (full width) | **Mute**, **Hold/Resume** (56 px tiles, pressed state); **Transfer**, **Conference** disabled with "Not available yet — needs separate approval" |
| Ended | "Call ended · reason · duration" for a few seconds (engine) | back to idle | Call | disabled |
| Queue call on another device | "Connected on another device" | disabled | — | disabled |

Audio row at the bottom of the phone: current microphone and speaker names with inline selectors (existing `selectInput`/`selectOutput`; speaker selector disabled with reason when `setSinkId` is missing).

On **Queues / Calls / Breaks** pages a **compact call strip** stays at the top (state, number, timer, Answer/Reject or Mute/Hold/End) so a call is never hidden; the full phone returns on Workspace.

### Call / activity (centre-right)

- Idle: **Recent calls** list (this agent's real call history: time, number, queue, result) — clicking a row loads the number into the keypad; break timer when on break; one-line **Today** figures.
- Incoming: large incoming card (number, name, queue, ring timer, Answer/Reject — same actions as the phone).
- In call: call summary (direction, queue, linked/unlinked status, interaction ID) and any correlation warning.
- After call: result and the FreeSWITCH wrap-up note (see §6).

### Context panel (right, 320 px)

Customer: number, caller name, **dialled number (DNIS)**, queue, **current duration**, interaction ID, "No CRM connected". Previous calls with this number (existing agent-scoped history; current call excluded). My queues: waiting / available. Collapses under the workspace below 1280 px.

## 3. Component hierarchy

```
Dashboard (data + events only — unchanged logic)
└─ PhoneBridge (usePhone → phone)
   └─ AppShell (top bar, rail, main, aside)
      ├─ NotReachableBanner
      ├─ WorkspacePage                 (Workspace view)
      │  ├─ PhoneConsole               new: status bar, PhoneDisplay, Keypad(lg), PrimaryAction, CallControls, AudioDevices, PhoneSignIn
      │  └─ CallActivityPanel          new: RecentCalls | IncomingCard | CallSummary | AfterCall ; CurrentBreakPanel ; ActivityStrip
      ├─ CallStrip                     new: compact call bar on other pages
      ├─ Queues / CallHistory / BreakHistory pages (existing)
      └─ aside: CustomerPanel (+DNIS, duration), QueueSummary
```

Files: `src/workspace/phone/` (PhoneConsole, PhoneDisplay, CallControls, AudioDevices, PhoneSignIn, Keypad), `src/workspace/activity/` (CallActivityPanel, RecentCalls, IncomingCard, CallSummary), `src/workspace/CallStrip.jsx`, `src/workspace/WorkspacePage.jsx`. `Dashboard.jsx` shrinks to data + page selection.

## 4. Interaction flows

1. **Log in → phone ready**: top-bar Phone lamp + phone status bar; if Available and not registered → red banner + sign-in in the phone.
2. **Outgoing**: click digits or type → Call → Calling… (Cancel) → Connected (timer, controls) → End call → result → idle.
3. **Incoming queue call**: ESL offer → (browser rings) → one incoming card + phone display; Answer/Reject → in call; customer panel fills from existing APIs.
4. **DTMF**: in call, keypad or keyboard digits → `sendDtmf` → tones trail.
5. **Devices**: change microphone/speaker in the phone audio row (live during a call).

## 5. Responsive approach

| Width | Layout |
|---|---|
| ≥ 1440 | rail · phone 440 · activity (flex) · context 340 |
| 1280–1439 (1366 target) | rail · phone 420 · activity (flex) · context 320 |
| 1024–1279 | rail · phone 400 · activity; context moves below activity |
| 768–1023 | rail · phone full width; activity and context stacked below |
| < 768 | bottom nav; phone first, then the rest |

Light and dark use the existing tokens. Keyboard: tab order phone → activity → context; visible focus rings; keypad keys have labels; buttons ≥ 40 px (keypad 56 px, controls 56 px tiles).

## 6. Items that cannot be done frontend-only (need separate approval)

| Item | Why | Smallest change |
|---|---|---|
| **Wrap-up countdown** | the agent API does not return the agent's `wrap_up_time`, and FreeSWITCH sends no wrap-up event | read-only: add `wrap_up_time` to `GET /agent-desk/me` (backend). Until approved: show "Wrap-up time is applied by FreeSWITCH" without a timer |
| **Connection quality** (jitter, packet loss, MOS) | needs `RTCPeerConnection.getStats()`; the engine does not expose the media session | read-only `getCallStats()` in `PhoneService` (engine, no signalling change). Until approved: not shown |
| Transfer, Conference | SIP REFER / conference bridge | as in blueprint §9 |
| Microphone level meter / speaker test | would open a second microphone stream outside the engine | optional; frontend-only but adds a parallel `getUserMedia`; propose later |

## 7. Before / after

| Area | Current preview | Proposed |
|---|---|---|
| Keypad | hidden behind icon | full 3×4, 56 px keys, always visible, dials and sends DTMF |
| Phone location | right panel (status, sign-in, devices) | centre-left console with all phone functions |
| Call controls | small row in a card | 56 px tiles + full-width Call / Answer-Reject / End |
| Empty space | large empty area below call card | phone + call/activity fill the workspace height |
| Phone visibility | lamp + small panel | status bar (registration, ext), duration, mic, speaker in one place |
| Other pages | full call card repeated | compact call strip |
| Customer | number, name, queue | + dialled number, live duration |

## 8. Implementation plan (after approval) — small reviewable stages

| Stage | Files | Commit |
|---|---|---|
| A | `workspace/phone/*` (console, keypad lg, controls, audio, sign-in) + tests | local |
| B | `workspace/activity/*`, `WorkspacePage.jsx`, `CallStrip.jsx` + tests | local |
| C | `ContextPanels.jsx` (DNIS, duration), `Dashboard.jsx` slimmed to data + view; remove superseded `InteractionWorkspace`, `Dialer`, `PhoneCard` | local |
| D | responsive + theme pass, screenshots 1366 / 1920, report | local |

Each stage: tests + build in the throwaway copy, preview refresh on 8095, owner check. No push until approved.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Wrong call merged | keep `correlate.js` rules (tested); unlinked warning otherwise |
| Physical-keyboard DTMF fires while typing elsewhere | only when focus is inside the phone console and not in an input |
| Double dial | Call disabled while placing and whenever a call exists |
| Layout overflow at 1366 × 768 | fixed heights measured; screenshots at both resolutions |
| Regression in engine/phone | no engine, provider, hook or backend change; existing 113 softphone tests + new UI tests |

## 10. Regression test plan

Automated: all existing tests (154 now, incl. 113 softphone), new component tests per stage, typecheck, build with phone on/off (sip.js only when on).

Manual on 8095 (owner, 1000 browser / 1001 MicroSIP / queue call): login/logout · phone sign-in and lamp · Not-reachable banner · outgoing call + Cancel · incoming + Answer/Reject · queue call linked card + customer panel · mute/unmute (audio checked) · hold/resume · DTMF heard at far end · mic/speaker change · end call → idle · status changes and break · queue figures · socket reconnect (restart backend lamp) · light/dark · 1366 and 1920 screenshots.

Report keeps: automated passed / build passed / visually checked / real call verified / not tested — separately.
