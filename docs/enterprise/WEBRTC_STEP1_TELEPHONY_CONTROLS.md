# WebRTC softphone, Step 1: telephony controls (FS-CC Agent Desktop)

Date: 2026-11-08. Status: **implemented and automated-tested on the laptop copy; not committed; Ubuntu-FS manual test pending.**

## 1. Scope and decision

FS-CC is the production home of the agent softphone. The standalone `fs-webrtc` repository is a POC only and was **not** changed. FS-ENRS, the FS-CC backend, FreeSWITCH, Ubuntu-FS and certificates were **not** changed.

| Feature | Done | Engine API used (already existed) |
|---|---|---|
| Outgoing dial pad + Call button (typed or clicked digits, `0-9 * # +`) | yes | `dial()` |
| Cancel while the outgoing call is ringing | yes | `hangup()` (sends CANCEL) |
| Hold / Resume | yes | `toggleHold()` (re-INVITE) |
| In-call DTMF keypad (shows the tones sent) | yes | `sendDtmf()` (RTP RFC 2833, SIP INFO fallback) |
| Call timer (from answer; stops and disappears at hang-up) | yes | `call.answeredAt` |
| Remote number display (`sip:1001@…` shown as `1001`), direction, state (Ringing / Connected / On hold / Muted) | yes | `call.remoteIdentity`, `call.direction` |
| Microphone / headset selection (also switches mid-call) | yes | `refreshDevices()`, `selectInput()` |
| Speaker / headset selection | yes | `selectOutput()`; disabled with a note when the browser lacks `setSinkId` |
| Unchanged: sign-in, answer, reject, mute, hang up, sign out, "Enable audio" | yes | — |
| Not in scope: blind/warm transfer, call history, conference | no | — |

## 2. Changed files (FS-CC only)

| File | Change |
|---|---|
| `agent-desktop/src/features/softphone/ui/SoftphonePanel.jsx` | New sub-components: `DialPad`, `Keypad`, `ActiveCall`, `CallTimer`, `DeviceSettings`; helpers `formatDuration`, `displayNumber` |
| `agent-desktop/src/features/softphone/__tests__/softphonePanel.test.js` | Fake service gains the extra methods; 10 new tests |
| `docs/enterprise/WEBRTC_STEP1_TELEPHONY_CONTROLS.md` | This document |

No engine (`engine/src/**`), hook, provider, adapter, backend, `package.json` or dependency change.

## 3. Security and governance checks

- The SIP password is still typed only at sign-in, held in component state until submit, then given to the engine (memory). A test asserts **no `Storage.setItem` call** and that the password never appears in the page.
- Dialled numbers and DTMF digits are not stored anywhere.
- Phone panel remains behind `VITE_WEBRTC_ENABLED=true`: a build without it contains no panel code (checked: 0 bundles contain the panel text; with it, 1).

## 4. Automated results (throwaway copy `/root/test/fs-cc-step1` on Ubuntu-FS, live app untouched)

| Check | Result |
|---|---|
| `vitest run` | **113 / 113 passed** (103 before + 10 new), 8 files |
| `npm run typecheck` | clean |
| `vite build` with phone on / off | both succeed; panel only in the "on" build |

The laptop has no `node_modules` test tools for FS-CC, so tests ran in the copy (same method as earlier checkpoints).

## 5. Manual test on Ubuntu-FS (owner)

Deploy (after approval and push): on Ubuntu-FS `cd /opt/freeswitch-ui/fs-cc && git pull --ff-only origin main`. Vite dev server picks the change up automatically; reload the page (Ctrl+F5). No restart needed.

Browser: Agent Desktop `https://192.168.1.124:8080`, agent on extension **1000**. Desk phone: MicroSIP **1001**. Keep F12 → Console open.

| # | Test | Expected |
|---|---|---|
| 1 | Sign in to the browser phone | "Phone ready"; `fs_cli -x "show registrations"` lists 1000 |
| 2 | Type `1001`, press **Call** | Panel: `1001 · Outgoing · Ringing…` and **Cancel**; MicroSIP rings |
| 3 | Press **Cancel** before MicroSIP answers | MicroSIP stops ringing; panel returns to the dial pad |
| 4 | Call 1001 again, answer on MicroSIP | Panel "Connected", timer starts at 00:00 and counts; two-way audio |
| 5 | **Hold** | Panel "On hold", button becomes **Resume**; MicroSIP hears hold music/silence; agent hears nothing |
| 6 | **Resume** | Two-way audio again; timer kept counting |
| 7 | **Mute** / **Unmute** | MicroSIP stops / again hears the agent; agent still hears MicroSIP |
| 8 | **Keypad**, press `1 2 3 #` | "Tones sent" shows `123#`; console `DTMF 1 sent via rtp`; `grep -a DTMF freeswitch.log` shows the digits (or call `*9664`/an IVR and navigate) |
| 9 | **Audio devices**: pick another microphone during the call | MicroSIP hears the new mic |
| 10 | **Audio devices**: pick another speaker/headset | Agent audio moves to that device |
| 11 | **Hang up** from browser | Timer disappears, dial pad back; MicroSIP call ends |
| 12 | MicroSIP calls **1000** | Panel `1001 · Incoming call`, Answer / Reject |
| 13 | **Answer**, talk, hang up from **MicroSIP** | Timer runs, then panel cleans up by itself |
| 14 | Incoming again, press **Reject** | MicroSIP gets busy/declined |
| 15 | Queue call via mod_callcenter (regression) | Rings and answers as before |
| 16 | **Sign out** | 1000 disappears from `show registrations` |

Logs if something fails: browser console; `pm2 logs fs-agent --nostream --lines 30`; `grep -a "1000\|1001" /opt/freeswitch/var/log/freeswitch/freeswitch.log | tail -50`.

## 6. Known limitations

- **Device names** appear only after the browser has microphone permission (granted at the first call). Before that the list shows "Microphone 1", etc. Opening "Audio devices" again refreshes the list.
- **Speaker selection** needs `setSinkId` (Chrome, Edge, recent Firefox). In others the dropdown is disabled and the system default is used. The ringtone follows the chosen speaker too.
- **Outgoing calls** follow the FreeSWITCH dialplan of the `default` context: extension-to-extension works in the lab; external numbers need a dialplan/gateway route (no change made here).
- **Hold** uses a SIP re-INVITE (`sendonly`); what the other party hears (music or silence) is decided by FreeSWITCH, not the panel.
- **DTMF** prefers RTP events (RFC 2833); if the call didn't negotiate them it falls back to SIP INFO.
- **One call at a time.** While a call is up, the dial pad is hidden. Call waiting / second line is not supported.
- The timer uses the browser's clock from the moment the call was answered.

## 7. Next items (not in Step 1)

1. Step 2: blind and attended transfer.
2. Step 3: call history and call details; conference later.
3. **Admin control (owner request):** an FS-CC Admin Centre setting per agent for the phone type (WebRTC browser phone / desk SIP phone / other softphone / external PBX), so administrators can see and control who uses the browser phone. This needs a backend + admin UI change and is planned separately; today the panel is enabled for all eligible agents by `VITE_WEBRTC_ENABLED`.
