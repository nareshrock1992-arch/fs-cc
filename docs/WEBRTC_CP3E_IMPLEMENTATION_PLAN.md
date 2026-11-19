# CP3-E Implementation Plan — Agent Desktop Integration

Approved 2026-11-19. Laptop FS-CC repo only. No Socket.IO, FreeSWITCH, queue, routing or reporting changes.

## Checkpoint 1 — audit of the current Agent Desktop (verified in source)
| Area | Today | Gap against CP3-B/C/D |
|---|---|---|
| Phone gate | Build flag `VITE_WEBRTC_ENABLED==='true'` lazy-loads `PhoneBridge` | No per-agent or customer-mode check. An EXTERNAL_PBX customer image with the flag on would offer the phone to everyone. |
| Signalling | `configAdapter` builds `wss` from `VITE_SIP_WSS_URL`; `authAdapter.resolveWssUrl()` returns it unchanged; SIP.js goes **direct to FreeSWITCH :7443** | Must use relay tickets; the WSS URL and domain must not be built in |
| Extension | Parsed from `agent.contact` in the browser | Must come from the server (the ticket response) |
| Reconnect | Engine `ReconnectScheduler` → `ua.reconnect()` to the **same URL** | Would reuse a spent ticket → every reconnect fails |
| Logging | SIP.js logs `Connecting <server>`; errors include `creds.wssUrl`; `state.account.wssUrl` is rendered | The ticket would appear in logs and UI → must be redacted |
| Refresh | `pagehide` → unregister; the password must be typed again after reload | Reload takes longer than the 15 s grace → **false PHONE_OFFLINE** |
| Phone vs agent state | Phone lamp inside the "System status" popover; console status bar | No CP3-D `phone_status`, `agent:phone` or `agent:webrtc-changed`; no 409 handling; no recovery prompt |
| Call features (engine, working) | Answer, reject, hang-up, mute, hold/resume, DTMF, blind transfer (REFER), consult transfer, swap, complete, 3-way conference, audio devices | Already real. Keep and reuse. |
| Disposition | **No backend API** | Not shown (no non-working controls) |
| Wrap-up | mod_callcenter `wrap_up_time` exists; the agent goes `Idle` during wrap-up | Read-only wrap-up indicator possible from real state |
| Incoming call | Inside the console only | A distinct, keyboard-operable notification is needed |

Component map, reused or new:
- **AgentWorkspace** = `workspace/Desk.jsx`.
- **AgentPresence** = `shell/StatusSelector.jsx`.
- **PhoneConnectionStatus** = **new** `shell/PhoneConnectionStatus.jsx`.
- **ActiveCallPanel** = `workspace/phone/PhoneConsole.jsx` (+ `PhoneParts.CallDisplay`).
- **IncomingCallNotification** = **new** `workspace/phone/IncomingCallNotification.jsx`.
- **CallControls** = **new** `workspace/phone/CallControls.jsx`, extracted from PhoneConsole.
- **CallHistory** = `workspace/RecentCalls.jsx` + `components/CallHistory.jsx`.
- **WrapUpPanel** = **new** `workspace/WrapUpPanel.jsx`.
- **Phone presence state (single source)** = **new** `features/softphone/presence.js` (pure reducer), used by Dashboard.

## Checkpoint 2 — relay integration
- **Engine:**
  - `Credentials.ticketProvider?(kind)` returns a fresh relay URL.
  - `login()` uses `'connect'`. **Every** reconnect calls `ticketProvider('reconnect')` and points the **same** UserAgent at the new URL (`SipClient.reconnect(url)` sets SIP.js transport `configuration.server`). Live dialogs survive, and an old ticket is never reused.
  - A 403/404 from the ticket endpoint stops reconnecting and signs the phone out ("Browser phone is no longer enabled").
  - URLs are redacted (`?ticket=…` → `?ticket=***`) in every log line, error and `state.account`.
- **`authAdapter`:** `fetchRelayTicket(kind)` (agent JWT, existing API client) and `relayUrlFor(ticketResponse, apiBase, location)`. The URL is derived from the API base and the page origin, `https`→`wss`. No domain, IP or URL is built in.
- **`configAdapter`:** no `VITE_SIP_DOMAIN` / `VITE_SIP_WSS_URL` (the direct path is removed). `VITE_WEBRTC_ENABLED` becomes an optional kill switch, on unless set to `false`. The **runtime gate** is `/me.webrtc_allowed`, which covers mode, per-agent switch, gateway and inactive.
- **`usePhone.login(password)`:** fetch the ticket → extension and domain from the server → `service.login`. The password stays in memory only, as today.
- **Dashboard:** sip.js is lazy-loaded **only** when `webrtc_allowed` is true, so EXTERNAL_PBX and non-WebRTC agents never load it, never fetch tickets and never connect.
- **Duplicate sessions:** one engine singleton per page; the relay replaces older sessions server-side.

## Checkpoint 3 — presence and lifecycle
- `presence.js` reducer combines the engine state (connecting, registered, reconnecting) with the server `phone_status` (grace, offline) into one phone indicator: `Signed out / Connecting / Registered / Reconnecting / Offline`.
- Socket events: `agent:phone` and `agent:webrtc-changed` (existing socket and room; the agent filters on its own id).
- **Available while offline:**
  - the selector disables Available, with the reason shown;
  - the 409 from the server is shown as a message;
  - the status is not changed locally.
- **Recovery prompt** when the phone is back and the break is PHONE_OFFLINE ("Phone is back — set yourself Available when ready"). Never automatic.
- **`agent:webrtc-changed {allowed:false}`:** "Browser phone will turn off after this call", then phone logout and hide once there's no call. `allowed:true` → load the phone.
- **Refresh:**
  - On `pagehide` the desk sends `POST /agent-desk/webrtc/page-reload` with `fetch(..., {keepalive:true})` and the agent JWT.
  - The backend gives that agent's next grace a one-time **60 s** reload allowance, at most once per 5 min.
  - The reloaded desk opens the phone sign-in at once.
- **Logout:** phone logout, then `Logged Out` (the server also closes the relay).

Small backend additions: the `page-reload` route and `presence.expectReload()`; `/me` returns `wrap_up_time`. Both are read-only or additive.

## Checkpoint 4 — UI
- **Header:** agent status (AgentPresence) and **separate** PhoneConnectionStatus pill. Compact, no gradients or glow.
- **IncomingCallNotification:** a banner at the top of the workspace on every view, with number, name, queue, ringing timer and **Answer / Reject**.
  - `role="alertdialog"`, focus moved to Answer, Enter = answer.
  - Shown only when the call is ringing on this browser phone.
- **CallControls:** mute, hold/resume, transfer, conference. Shown only when the browser phone is in use, and enabled only in a call.
- **WrapUpPanel:** shown when the agent is Available and mod_callcenter state is `Idle` after a call. Countdown from `wrap_up_time`. Read-only; no disposition field, because no backend exists.

## Out of scope
Disposition codes, CRM, TURN, CP8 (real FreeSWITCH, audio, deployment).
