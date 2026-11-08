# Agent Desktop telephony UI redesign: final report (Stages A–D)

Date: 2026-11-08. Plan: `AGENT_DESKTOP_UI_IMPROVEMENT_PLAN.md` (approved). Repository `Documents\fs-cc`, branch `main`.

## 1. Git state

| | Commit |
|---|---|
| GitHub `origin/main` / Ubuntu-FS | `4359507a` (Phase 2 shell) |
| Laptop `main` (not pushed) | 7 local commits → HEAD after Stage D |

Local commits: `27534810` Phases 3–4 workspace · `0d74b9da` queue-offer fix · `a4a294e9` previous-calls fix · `9fee1082` Stage A console · `56f9b118` Stage B call strip + recent calls · `73202d29` Stage C customer fields + Desk · Stage D (this report, contrast and width fixes).

Diff since `4359507a` (agent-desktop): 19 files, ~+1,850 / −240 lines.

## 2. What the agent gets

| Area | Result |
|---|---|
| Top bar | queues, 4 separate lamps (Server, Live, FreeSWITCH, Phone), agent + extension, status menu, theme, sign out |
| Phone console (Workspace, centre-left) | status bar (registration, ext, sign out) · large number display with ⌫ and ✕ · **always-visible 3×4 keypad** (dials; DTMF in a call; keyboard digits too) · full-width Call / Answer+Reject / Cancel call / End call · 56 px Mute and Hold/Resume tiles · Transfer and Conference shown unavailable · microphone and speaker selectors · password sign-in (memory only) |
| Call details (centre-right) | idle: readiness + recent calls (click loads number) · incoming: one card with number, name, queue, ring timer, Answer/Reject · active: summary + duration · ended: result + reason · correlation warning / unlinked queue strip when needed |
| Other pages | compact call bar with Answer/Reject, Cancel, Mute/Hold/End, Keypad → console |
| Right panel | customer: number, caller name, **dialled number**, direction, queue, **live duration**, interaction ID, previous calls (current excluded) · my queues |
| Warnings | Not reachable (Available + phone not registered) |

## 3. Stage D review (code-level; screenshots pending)

| Check | Finding | Action |
|---|---|---|
| Dark theme contrast of Call/Answer/End/Reject | white text on the dark theme's light green/red ≈ 2–3:1 | new tokens `--btn-call`, `--btn-danger` (#12805C, #C42B2B in both themes) ≈ 4.8:1 / 5.6:1 |
| 768–1023 px | console stretched to full width (very wide keys) | console capped at 28 rem and centred below 1024 px |
| 1366 × 768 | console ≈ 650 px tall + 56 px top bar → fits; sign-in form or Not-reachable banner add ~70 px (page scroll inside main only) | none |
| ≥ 1280 px | three columns (console 416 · details · context 320) | none |
| Hard-coded colours | none besides white text on solid buttons | none |
| Keyboard | all controls are buttons/selects with labels; focus rings; DTMF from keyboard only inside the console and not in inputs | none |

## 4. Verification (kept separate)

| Type | Status |
|---|---|
| Automated tests | **167 / 167 passed** (13 files). Includes the **113 original softphone tests**, all passing. 7 tests of removed components (old dialer, phone card, duplicate controls) were deleted; the console tests cover those behaviours |
| Typecheck | clean |
| Build | phone on ✓ / phone off ✓ (sip.js only in the "on" build) |
| Browser visual (owner screenshots, 8095) | idle workspace (Phases 3–4 layout), ringing queue call (linked, queue + name), active queue call with DTMF tones — **before Stage A**. Stages A–D layout: **not yet seen** |
| Real FreeSWITCH / WebRTC (owner) | ✓ registration; ✓ incoming queue call rings browser; ✓ linked single card with queue and caller name; ✓ answer; ✓ DTMF sent (shown). **Not yet confirmed:** mute/unmute audio, hold/resume audio, DTMF heard at far end, mic/speaker change, outgoing call + cancel, reject, end-call summary, call strip on other pages, socket reconnect, logout |
| Not tested | transfer, conference (not implemented); 1920 × 1080 and dark-theme screenshots |

## 5. Business-logic protection

Unchanged: sip.js engine, PhoneService, PhoneProvider, usePhone, adapters, backend, database, FreeSWITCH, ESL, mod_callcenter, API client, socket client, JWT/auth, status values and transitions, break logic, polling intervals, `.env*`, FS-ENRS, FS-WebRTC.

Changed behaviour (display only, documented in Phase 3–4 report §10): a ringing queue offer is kept on screen until answered / no-answer / abandoned / hung up (the `/calls` poll lists only answered calls), and enriched from the existing call-detail API.

## 6. Known limitations

- Correlation of queue call and browser call is rule-based (no shared identifier); unusual cases show a warning instead of merging.
- Wrap-up countdown and call-quality figures need small backend/engine additions (plan §6).
- Transfer and conference are not implemented.
- Previous calls show this agent's **queue** calls only.
- "Not reachable" cannot detect a desk phone on the same extension (planned admin phone-type setting).
- Speaker selection depends on browser support (`setSinkId`).
- `SoftphonePanel.jsx` (Step 1) is kept, unmounted, so its tests keep guarding engine integration.

## 7. Remaining work

1. Owner: screenshots (1366 × 768, 1920 × 1080, dark) and the open real-call checks in §4.
2. Approval to push the local commits; then `git pull --ff-only` on Ubuntu-FS and stop the 8095 preview.
3. Separate approvals: wrap-up time field, call-quality stats, transfer/conference, admin phone type.
