# Agent Desktop redesign blueprint (Phase 1, for approval)

Date: 2026-11-08. Based on `AGENT_DESKTOP_CURRENT_STATE_AUDIT.md`. **No production code changed.** Genesys Cloud, Amazon Connect, Talkdesk and Zoom Contact Center are used only as workflow references.

## 1. Principles

1. The **active customer interaction** owns the centre of the screen; statistics move out of the way.
2. **Every control does something real** or is shown as unavailable with a reason. No fake channels, no fake customer data.
3. **Frontend only** for Phases 2–4. Business logic (status API, mod_callcenter, ESL, SIP engine, polling, socket events) is consumed through adapters, not rewritten.
4. No new dependencies: React + Tailwind tokens + lucide icons, no router or component library (a 3-item navigation does not justify one).
5. Accessible: keyboard operable, visible focus, ARIA labels, colour + text for every status.

## 2. Layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR  [FS-CC Agent]   Queues: Sales, Support     ●App ●Live ●FreeSWITCH ●Phone    │
│          Agent: Naresh · Ext 1000   [● Available ▾]  🔔  ⚙  ☾  ⎋                      │
├──┬──────────────────────────────────────────────────────────┬────────────────────────┤
│N │ INTERACTIONS (tabs/list)                                 │ CUSTOMER                │
│A │ [☎ 1001 · 02:14 · Connected] [☎ queue Sales · ringing]    │ Caller name / number    │
│V │──────────────────────────────────────────────────────────│ DNIS · Queue            │
│  │ ACTIVE INTERACTION                                       │ Previous calls (mine)   │
│▣ │  ☎ 0501234567  "John"   Queue Sales   Inbound   02:14    │  – 12 Nov 10:02 2m ans  │
│⟲ │  Status: Connected · On hold / Muted badges              │  – 03 Nov 16:40 missed  │
│☕ │  ┌ Call controls (context-sensitive) ──────────────────┐ │                         │
│▤ │  │ Mute  Hold  Keypad  Transfer*  Conference*  End     │ │ QUEUE CONTEXT           │
│  │  └──────────────────────────────────────────────────────┘ │ Sales: 3 waiting        │
│  │  Wrap-up: 00:12 / 00:20 (FreeSWITCH timer)                │ Support: 0 waiting      │
│  │  Notes / disposition*  (shown disabled until backend)     │                         │
│  │                                                           │ PHONE                   │
│  │ IDLE STATE: Dialer card (number, keypad, Call)            │ Reg. 1000 ✓ · devices   │
└──┴──────────────────────────────────────────────────────────┴────────────────────────┘
* only enabled when supported (see §9)
```

- **Top bar** (56 px): product, agent identity + extension, assigned queues (from `/queues`), **four separate connection lamps** (App/API, Live socket, FreeSWITCH ESL, Phone SIP registration) each with tooltip text, the **status selector** (reuses `StatusControls` logic and break codes), notifications bell (in-app list of missed calls/no-answer/errors from existing events only), settings (audio devices, theme), logout.
- **Navigation rail** (56 px, expands to 200 px): Workspace · Call history · Break history · My queues & performance. Collapses to a bottom bar under 768 px.
- **Workspace** (fluid): interaction strip on top, active interaction below; when idle, the dialer card + today's summary.
- **Context panel** (320 px, collapsible; drawer under 1280 px): customer, queue context, phone/device status.

## 3. Status presentation (no transition changes)

| What the agent sees | Source | Rule |
|---|---|---|
| Available / On Break (reason + timer) / Logged Out | `agent.status` | settable exactly as today |
| On call | derived: active interaction | badge only, not a status |
| Ringing | `agent:offering` or SIP `ringing-in` | badge |
| Wrap-up (After call) | mod_callcenter state after hang-up + agent `wrap_up_time` | read-only countdown |
| **Not reachable** warning | status = Available **and** browser phone enabled **and** SIP not registered | red banner "You're Available but your phone is not registered — calls will fail" |

The selector never offers "Busy", "On Call" or "After Call Work" because the backend does not support them.

## 4. Interaction model (frontend only)

```ts
Interaction {
  id: string;                  // call_uuid if known, else SIP session id
  channel: 'voice';            // future: 'chat' | 'whatsapp' | 'email' | 'sms' | 'social' | 'bot-handoff'
  direction: 'inbound' | 'outbound';
  status: 'offering' | 'ringing' | 'connected' | 'held' | 'wrap-up' | 'ended';
  customer: { number?: string; name?: string };   // only real fields
  queue?: string;  dnis?: string;
  startedAt?: string; answeredAt?: string;
  sources: { esl?: LiveCall; sip?: CallInfo };    // raw inputs kept for debugging
  capabilities: { mute, hold, dtmf, transfer, conference, end: boolean };
}
```

- `useInteractions()` adapter merges the **ESL queue call** (`/calls`, socket events — today's `LiveCallPanel` data) with the **browser phone call** (`usePhone().state.call`) into one interaction when they match (same remote number while both active); otherwise shows them as separate items.
- `channels/voice/` holds `VoiceInteractionView` and `VoiceControls`. A channel registry (`channels/index.js`: `{ voice: { View, Controls, icon, label } }`) is the extension point. Future channels add a folder; the workspace does not change. **No placeholder chat/email UI is shown** — the registry simply has only `voice`.
- `capabilities` is computed from real state, which drives context-sensitive buttons.

## 5. WebRTC phone design

- **Idle:** dialer card in the workspace — number field (paste-friendly), 12-key pad, Call; "recent numbers" from **this agent's call-history API** (real data) as quick-dial chips.
- **Incoming:** a toast-style notification at top right + the interaction strip flashes; big Answer / Reject; caller number, name, queue (from ESL when matched).
- **In call:** control bar `Mute · Hold · Keypad · Transfer · Conference · End`, each with state (pressed, disabled + tooltip reason). Timer, badges (On hold, Muted), DTMF tones sent.
- **Phone status** in context panel: registration lamp, extension, reconnect attempts, Sign in / out, device selectors (moved from today's panel).
- **Keyboard shortcuts** (on focus inside desktop): `A` answer, `R` reject, `M` mute, `H` hold, `E` end, digits during call → DTMF.
- The engine (`engine/src/**`), `usePhone`, provider, adapters: **unchanged** in Phases 2–4 unless §9 items are approved.

## 6. Customer context panel (real data only)

Shows: number, caller name, DNIS, queue, direction, and "Your previous calls with this number" using `GET /call-history?search=<number>` (agent-scoped). Email, customer reference, CRM link, notes: **not shown** until a data source exists (one line "No CRM connected" rather than empty fields).

## 7. After-call workflow

Today (no backend change): call ends → interaction moves to **Wrap-up** with the FreeSWITCH wrap-up countdown (read-only) → removed when mod_callcenter state returns to waiting. Agent can still go On Break / Logged Out via the selector, as today.

With approved backend (§9-B): disposition dropdown + notes + "Complete" saved to a new table; wrap-up behaviour in FreeSWITCH unchanged.

## 8. Design system (Phase 2)

- Reuse existing CSS-variable tokens (light/dark, shared with Admin). Consolidate legacy `panel/lamp/brand` names onto `surface/status/primary` aliases (no visual break).
- Type: system UI stack, sizes 12 / 13 / 14 / 16 / 20, numbers in tabular monospace.
- Spacing 4-px scale (4, 8, 12, 16, 24, 32). Radius 6 (controls), 8 (cards). 1-px borders, no glows, gradients or blur; shadow only on popovers.
- Components (`src/ui/`): `Button` (primary, secondary, ghost, danger, call-green, icon), `IconButton`, `Badge`, `StatusDot`, `Lamp`, `Card`, `Section`, `Select`, `Input`, `Tabs`, `NavRail`, `Popover/Menu`, `Toast`, `EmptyState`, `Kbd`, `Timer`.
- Breakpoints: < 768 (one column, bottom nav, context as drawer), 768–1279 (rail + workspace, context drawer), ≥ 1280 (three columns).

## 9. Items that need changes outside the frontend (stop points)

| Item | Why the frontend can't do it | Proposed approach | Touches |
|---|---|---|---|
| **A. Blind transfer** | engine has no REFER | add `transfer(target)` to `PhoneService` using sip.js `session.refer()`; FreeSWITCH accepts REFER by default | WebRTC engine (signalling) |
| **A2. Attended transfer** | needs second call + REFER with Replaces | engine: hold call 1, dial target, `refer(call2)`; UI two-line view | WebRTC engine |
| **A3. Queue-call transfer when agent uses a desk phone** | browser has no SIP session | backend ESL `uuid_transfer` endpoint | backend + ESL |
| **B. Disposition + notes** | no table, no API | migration `call_wrapup(call_uuid, agent_id, disposition, notes, created_at)` + `POST /agent-desk/calls/:uuid/wrapup` + admin-defined disposition codes | DB + backend |
| **C. Conference (3-way)** | needs a FreeSWITCH conference bridge | ESL `conference` or dialplan; later phase | FreeSWITCH/back-end |
| **D. Admin per-agent phone type** (owner request) | no field | `agents.phone_type` (webrtc / desk SIP / softphone / external PBX) + Admin UI; Agent Desktop shows the browser phone only when `webrtc` | DB + backend + Admin |
| **E. CRM/customer data** | no source | future integration API | backend |

Until approved, Transfer and Conference buttons are **shown disabled** with the tooltip "Not available yet" (or hidden — owner's choice), notes/disposition are hidden.

## 10. API → UI mapping

| UI | Source |
|---|---|
| Identity, extension | `agent` from login / `GET /me` |
| Status selector, break timer | `POST /status`, `GET /me`, `break-codes`, socket `agent:status`, `agent:state` |
| Connection lamps | App: last API success; Live: `socket.connected`; FreeSWITCH: `esl:status`/`/esl-status`; Phone: `usePhone().state.registration` |
| Interaction strip / active call | `/calls` poll + `agent:offering`, `call:bridged`, `call:bridge-end`, `agent:no-answer`, `channel:hangup` + `usePhone().state.call` |
| Call controls | `usePhone()` actions |
| Customer panel | interaction fields + `GET /call-history?search=` |
| Queue context | `GET /queues` (+ `call:enqueued`, `call:abandoned`) |
| Performance (rail page / idle summary) | `GET /performance` |
| History pages | existing `CallHistory`, `BreakHistory` |
| Notifications | `agent:no-answer`, phone errors, ESL down, registration lost |

## 11. Current vs proposed

| Area | Current | Proposed |
|---|---|---|
| Layout | one scrolling column | top bar + nav rail + workspace + context panel |
| Live call | two separate panels (ESL, phone) | one interaction card |
| Status | buttons block mid-page | header selector + break banner + "not reachable" warning |
| Connectivity | ESL badge only | 4 distinct lamps |
| Phone | card in page | dialer when idle, control bar in call, phone/devices in context panel, shortcuts |
| Customer | ANI/name inside call panel | context panel + your past calls with that number |
| Queues/KPIs | big cards on main page | compact queue list in context panel; KPIs on own page / idle summary |
| History | tabs | navigation pages (same components, restyled) |
| Omnichannel | none | channel registry + interaction model (voice only) |

## 12. Implementation sequence (each phase: tests, build, docs, stop for approval)

| Phase | Content | Backend change |
|---|---|---|
| 2 | `src/ui/` components, tokens tidy-up, `AppShell` (top bar, rail, layout, connection lamps), status selector moved to header; existing pages placed inside shell | none |
| 3 | `useInteractions` adapter, interaction strip + active interaction, customer panel (real data), queue context, wrap-up countdown, history pages restyled | none |
| 4 | phone redesign: dialer, incoming notification, control bar, keyboard shortcuts, phone/devices panel; Transfer/Conference shown unavailable | none |
| 5 | regression (auth, status, break, queue calls via ESL, browser calls, reconnect, refresh, responsive), screenshots before/after, final report | none |
| Later (separate approval) | §9 A blind/attended transfer (engine) → B disposition/notes → D admin phone type → C conference | yes |

Estimated size for Phases 2–5: ~2,000–2,500 lines new/changed frontend code + tests, delivered in four reviewable commits.

## 13. Protection

Not touched in Phases 2–5: backend, DB, FreeSWITCH, dialplan, ESL, mod_callcenter, softphone engine, `api/client.js` endpoints, auth storage, socket event handling semantics, polling intervals, `.env*`, FS-ENRS, FS-WebRTC. Existing tests must keep passing; new tests cover the adapter, capabilities, shell and controls.
