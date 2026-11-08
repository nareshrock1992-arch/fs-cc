# Agent Desktop redesign, Phase 2: design system and application shell

Date: 2026-11-08. Status: **implemented, automated checks pass, not committed, not yet seen on Ubuntu-FS.** Follows `AGENT_DESKTOP_REDESIGN_BLUEPRINT.md` §2, §3, §8, §12.

## 1. What changed for the agent

| Before | After |
|---|---|
| Single scrolling page with a header (logo, "FS Connected" badge, name, theme, logout) | **Top bar**: product, assigned queue names, **4 separate connection lamps** (Server · Live · FreeSWITCH · Phone), agent name + ID + extension, **status selector**, theme, sign out |
| Status buttons card in the middle of the page (Available / Take Break ▾ / Log Out) | **Status selector in the top bar**: shows "Available" or "On Break · Lunch"; menu offers Available, the configured break reasons, Log out of queues |
| Tabs: Dashboard · Call History · Break History | **Navigation rail** (left; bottom bar on phones): Workspace · Queues · Calls · Breaks |
| Footer bar | small line at the end of the page |

Workspace page still shows, in this order: current break panel (when on a break), live queue call, browser phone, today's performance, my queues. The Queues page shows the live queue call + queues. Call and break history are unchanged components. The right-hand context panel is prepared in the shell and is filled in Phase 3.

## 2. Connection lamps (display only)

| Lamp | Green when | Source (existing) |
|---|---|---|
| Server | last FS-CC API call succeeded | the existing 3-s `GET /agent-desk/queues` poll |
| Live | Socket.IO connected | `socket.connected` + `connect`/`disconnect` events |
| FreeSWITCH | backend ↔ FreeSWITCH connected | `esl:status` event / `GET /esl-status` (as before) |
| Phone | browser phone registered ("Phone ready") | softphone store via `PhoneStatusProbe` (only built when `VITE_WEBRTC_ENABLED=true`) |

Amber = connecting / reconnecting / on a call (blue); red = failed; grey = off / not available for this agent. Hover shows the full text; screen readers read it.

## 3. Design system

`src/ui/primitives.jsx`: `Button` (primary, secondary, ghost, danger, call, toggled; sizes sm/md/lg), `IconButton` (label required → aria-label + tooltip), `StatusDot` + `LEVEL_CLASS`, `Badge` (neutral, ok, busy, warn, break, error), `Section` (card with header), `EmptyState`. All use the existing CSS-variable tokens (light + dark, shared with Admin). 1-px borders, radius 6/8, no gradients, glows or blur; shadow only on the status menu. Visible keyboard focus ring on all new controls.

## 4. Changed files (FS-CC `agent-desktop` only)

| File | Change |
|---|---|
| `src/ui/primitives.jsx` | new — design-system components |
| `src/shell/AppShell.jsx` | new — top bar, navigation rail, main, optional context panel |
| `src/shell/ConnectionLamps.jsx` | new — `buildLamps()` + lamp list |
| `src/shell/StatusSelector.jsx` | new — header status menu (same API calls as the old card) |
| `src/features/softphone/ui/PhoneStatusProbe.jsx` | new — reports phone indicator to the shell; no actions |
| `src/pages/Dashboard.jsx` | layout replaced by `AppShell`; adds lamp state (`apiOk`, `socketUp`, `phoneLamp`); "Queues" view. **All data fetching, polling intervals, socket handlers, status/break/logout logic unchanged** |
| `src/components/StatusControls.jsx` | removed — replaced by `StatusSelector` (same behaviour) |
| `src/components/EslBadge.jsx` | removed — replaced by the FreeSWITCH lamp |
| `vitest.config.js` | test include adds `src/shell`, `src/ui`; automatic JSX runtime for tests only |
| `src/shell/__tests__/shell.test.js` | new — 9 tests |

## 5. Business-logic protection

Not changed: backend, database, FreeSWITCH, dialplan, ESL, mod_callcenter, `api/client.js`, `api/socket.js`, auth (`useAgentAuth`), softphone engine/hook/provider/panel, polling intervals, socket business events, status values and transitions, break logic, `.env*`, `vite.config.js`, FS-ENRS, FS-WebRTC.

The status selector sends exactly what the old card sent: `Available` (no code), `On Break` + configured code, `Logged Out`; "Logged Out" still stops the browser phone and signs the desk out after 0.5 s via the unchanged `handleStatusChange`.

## 6. Results (throwaway copy `/root/test/fs-cc-step1` on Ubuntu-FS; live app untouched)

| Check | Result |
|---|---|
| Vitest | **122 / 122 passed** (113 before + 9 new), 9 files |
| Typecheck | clean |
| Build, phone on | OK; phone code present |
| Build, phone off | OK; **no** phone code in the bundle |

## 7. Not yet done / limitations

- Before/after screenshots: taken in Phase 5 on Ubuntu-FS (needs the pull + an agent login).
- Context panel (customer, queue context), unified interaction card, phone redesign, "not reachable" warning: Phases 3–4.
- The "Server" lamp updates every 3 s (poll interval), so it can lag a failure by up to 3 s.
- Old components still use legacy token names (`panel-*`, `lamp-*`); they are aliases of the same colours and are restyled in Phases 3–4.
