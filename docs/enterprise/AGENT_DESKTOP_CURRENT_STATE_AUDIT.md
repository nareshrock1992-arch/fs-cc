# Agent Desktop: current-state audit (Phase 0, read-only)

Date: 2026-11-08. Repository `Documents\fs-cc`, branch `main`, HEAD `ded9fa2b`, working tree clean, level with `origin/main`. Active environment: laptop (source). Ubuntu-FS `/opt/freeswitch-ui/fs-cc` was at `ee35b94` (Step 1 not yet pulled) when checked. **No code was changed for this audit.**

## 1. Size and stack

| Item | Value |
|---|---|
| App | `agent-desktop/` — React 18, Vite 6, Tailwind 3 (CSS-variable tokens), lucide-react icons, socket.io-client, sip.js 0.21.2 |
| Size (excl. engine and tests) | ~2,500 lines; one page component (`Dashboard.jsx`, 443 lines) holds most logic |
| Routing | **None.** `App.jsx` shows `Login` or `Dashboard`; inside Dashboard a `view` state switches three tabs |
| State management | React `useState` in Dashboard; no context/store except the softphone `PhoneProvider` |
| Tests | 113 (Vitest + jsdom), all in `features/softphone` |
| Component library | none; Tailwind classes + a few CSS component classes in `index.css` (`.card`, etc.) |

## 2. Screens and component hierarchy

```
App
├─ Login                      agent_id + PIN → POST /agent-desk/login
└─ Dashboard (single page)
   ├─ Header: logo · EslBadge · agent name/status pill · ThemeToggle · Logout
   ├─ Toast (errors)
   ├─ LiveCallPanel           queue call from ESL (ringing/talking, ANI, caller name, queue, timer)
   ├─ Tabs: Dashboard | Call History | Break History
   ├─ [Dashboard tab]
   │   ├─ CurrentBreakPanel   (when On Break) break name, timer vs max/warn, Return
   │   ├─ StatusControls      Available / On Break (+ break code menu) / Logged Out
   │   ├─ SoftphonePanel      (only if VITE_WEBRTC_ENABLED) — Step 1 phone
   │   ├─ PerformanceCard     today's counts / talk time
   │   ├─ QueueCard × n       per assigned queue: waiting, answered, agents available…
   │   └─ footer: agent id, extension
   ├─ [Call History tab]  CallHistory — paged list + filters + detail
   └─ [Break History tab] BreakHistory
```

## 3. Backend APIs used (all existing, agent-scoped JWT)

| Endpoint | Data |
|---|---|
| `POST /agent-desk/login` | token + agent (agent_id, full_name, avaya_extension, contact, status, state) |
| `GET /agent-desk/me` | status, state, break_code/name/started_at, contact, extension |
| `POST /agent-desk/status` | **only** `Available`, `On Break` (+ break code), `Logged Out` |
| `GET /agent-desk/queues` | assigned queues with waiting, answered today, SLA-ish counts, available/break/logged-out agent counts |
| `GET /agent-desk/calls` | this agent's recent/active calls (ani, caller_name, queue, times) — polled every 3 s |
| `GET /agent-desk/performance` | today's KPIs — polled every 30 s |
| `GET /agent-desk/esl-status` | backend ↔ FreeSWITCH connection |
| `GET /agent-desk/break-codes`, `/break-history` | break configuration, history |
| `GET /agent-desk/call-history[?search,direction,disposition,dates]`, `/call-history/:uuid` | per-agent call list and detail: direction, ani, caller_name, dnis, queue, times, wait/talk/ring seconds, missed, system disposition |

Socket.IO events consumed: `esl:status`, `agent:offering`, `call:bridged`, `call:bridge-end`, `channel:hangup`, `agent:no-answer`, `agent:status`, `agent:state`, `call:enqueued`, `call:abandoned`. The socket authenticates with the agent JWT and joins room `agent:<id>`.

## 4. Agent state model (verified)

- **Status** (settable by agent): `Available`, `On Break` (with break code), `Logged Out`.
- **State** (from mod_callcenter, read-only): e.g. `Waiting`, `Receiving`, `In a queue call`, `Idle`.
- **Wrap-up:** mod_callcenter `wrap_up_time` per agent (default 20 s, set by admin). It runs inside FreeSWITCH automatically; there is **no** agent-facing "After Call Work" status, disposition or "complete wrap-up" API.
- "Busy", "On Call", "After Call Work" as **settable** statuses do not exist; "On call" can only be derived (state / active call).

## 5. Browser phone (WebRTC) — verified

- `features/softphone/`: engine (TypeScript, sip.js) → `PhoneService` + store → `usePhone()` hook → `SoftphonePanel.jsx`.
- Engine operations available: login/logout (register), dial, answer, reject, hangup/cancel, mute, hold (re-INVITE), DTMF (RFC 2833 / INFO), device list/select (mic, speaker via setSinkId), audio unlock, auto-reconnect.
- **Not available:** blind transfer (SIP REFER), attended transfer, conference, second line/call waiting.
- Password memory-only; panel compiled in only with `VITE_WEBRTC_ENABLED=true`; gateway agents not eligible.
- The phone's call (SIP session) and the ESL queue call (`LiveCallPanel`) are **two separate views of the same call** and are not linked today.

## 6. Data actually available about the customer

ANI (number), caller name (CID name), DNIS, queue, call times, wait/talk seconds, and this agent's previous calls (call-history `search`). **Not available:** email, customer reference/account, CRM record, notes, agent dispositions, history across other agents.

## 7. Design system (existing)

Tailwind tokens backed by CSS variables, light + dark (`ThemeToggle`), shared with the Admin UI (`UI_DESIGN_SYSTEM.md`): `bg/surface/border/primary`, `status.*` (available, oncall, ringing, onbreak, loggedout…), `panel.*`, `ink.*`, `lamp.*`. Some components still use legacy `panel/lamp` names alongside the newer `surface/status` names.

## 8. Limitations and redesign opportunities

| # | Finding | Opportunity |
|---|---|---|
| 1 | Single long scrolling page; stats and controls compete with the live call | Workspace layout: active interaction first |
| 2 | Two call panels (ESL `LiveCallPanel` + browser phone) | One interaction card fed by both sources |
| 3 | Header mixes ESL badge and status; no SIP registration or socket indicator | Separate indicators: App/API, real-time (socket), FreeSWITCH (ESL), Phone (SIP), Agent status |
| 4 | No routing; tabs in state | Left navigation rail (Workspace, History, Breaks, Queues) without adding a router dependency |
| 5 | Polling every 3 s for calls/queues alongside socket events | Keep as is (business logic), just consume in one adapter |
| 6 | Customer information limited to ANI/name | Customer panel showing only real fields + this agent's past calls with that number |
| 7 | No notes/disposition/wrap-up | Needs backend (see blueprint §9); UI can show wrap-up timer only |
| 8 | No transfer/conference | Needs engine and possibly FreeSWITCH/back-end work (blueprint §9) |
| 9 | Token and agent info in localStorage (existing auth design) | Unchanged in redesign; noted for a later security review |
| 10 | Footer/branding text hard-coded | Move into shell |

Reusable as-is: `api/client.js`, `api/socket.js`, `useAgentAuth`, `useTheme`, `StatusControls` logic, `CurrentBreakPanel` logic, `CallHistory`, `BreakHistory`, `QueueCard` data mapping, the whole softphone engine + `usePhone`.
