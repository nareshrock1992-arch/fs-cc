# FS-WebRTC → FS-CC: CP-5 Checkpoint Report

Date: 2026-11-08. Written on the **laptop** (`feature/webrtc-agent-desktop-phase2` @ `cfcf6f0`). Tested in the Ubuntu-FS scratch copy (`/root/test/fs-cc`, Node 22.23.4). **Not committed. CP-6 not started.**

## What CP-5 adds (Phase 2 plan step 2.8, R-4, R-5)

| File | Change |
|---|---|
| `features/softphone/ui/SoftphonePanel.jsx` (new) | A minimal "Browser phone" card in its own `PhoneProvider`. It shows the extension from the contact, a **single password field** (`autocomplete="off"`, cleared on submit), Sign in / Sign out, Answer / Reject for incoming calls, Mute / Hang up for active calls, "Enable audio" for autoplay blocks, a status lamp and errors. It never changes the agent's FS-CC status |
| `features/softphone/index.js` | Exports `SoftphonePanel` and `stopSoftphoneIfActive()`, which logs out an existing phone and never creates one or throws |
| `features/softphone/phoneSingleton.js` | Adds `peekPhoneService()` (read-only; never constructs) |
| `pages/Dashboard.jsx` | **Gated lines only** (+19 / −2): the `lazy` and `Suspense` imports; the `VITE_WEBRTC_ENABLED` constant; a lazy `SoftphonePanel`; `stopSoftphone()`; the panel rendered above `PerformanceCard`; the phone logged out **before** `setStatus('Logged Out')` in `handleLogout`, and on the "Logged Out" status change |
| `__tests__/softphonePanel.test.js` (new) | 7 tests: password-only form; sign-in passes the typed password and clears the field; gateway agent; missing config; Answer/Reject → Mute/Hang up; `stopSoftphoneIfActive` with and without a phone |

No change to FS-CC business logic, the API client, sockets, status rules, the backend, the engine (still byte-identical to `23ab1ce`), dependencies or config files.

## Results (Ubuntu-FS scratch copy)

| Check | CP-4 | CP-5 |
|---|---|---|
| Lockfile | `f90adbea…` | `f90adbea…` (unchanged) |
| Typecheck | exit 0 | **exit 0** |
| Tests | 7 files / 96 | **8 files / 103, all passed** |

**Build with the phone OFF** (the default; `VITE_WEBRTC_ENABLED` unset):

| | Baseline (CP-2 to CP-4) | CP-5 |
|---|---|---|
| CSS | `index-90arXMMA.css` 21.31 kB | **identical** (`index-90arXMMA.css`, 0 selectors added) |
| JS | 1 file, 236.37 kB | **1 file, 236.42 kB** (+0.05 kB: the gated Dashboard lines) |
| SIP.js / softphone code in the bundle | none | **none** (no `UserAgent`, no "Browser phone" strings; no extra chunk) |

**Build with the phone ON** (`VITE_WEBRTC_ENABLED=true`, `VITE_SIP_DOMAIN=192.168.1.124`, `VITE_SIP_WSS_URL=wss://192.168.1.124:7443`):

| Chunk | Size (gzip) | Loaded |
|---|---|---|
| `index-*.js` (app) | 238.07 kB (72.47) | always. SIP.js is **not** in it |
| `SoftphonePanel-*.js` (panel, engine, SIP.js) | 254.00 kB (60.61) | only when the Dashboard renders the panel |
| `softphone-*.js` (logout helper) | 0.39 kB | only on desk logout |
| CSS | `index-90arXMMA.css` 21.31 kB | unchanged |

## Issue found and fixed

- **New Tailwind classes in the panel** (`space-y-3`, `min-w-[10rem]`, `hover:opacity-90`, `mr-auto`) added 0.28 kB of CSS **even with the phone off**, because Tailwind scans all `src/**/*.{js,jsx}`. They were replaced with classes the app already uses, so the off build's CSS is byte-identical.

## How to switch it on (lab)

Add these to `agent-desktop/.env`. That file is Git-ignored and **was not changed by this work**; its values are not secrets:
```
VITE_WEBRTC_ENABLED=true
VITE_SIP_DOMAIN=192.168.1.124
VITE_SIP_WSS_URL=wss://192.168.1.124:7443
```
Then rebuild or restart the Vite dev server.
- The browser must trust the FreeSWITCH WSS certificate first: open `https://192.168.1.124:7443` once and accept the exception, because the certificate is self-signed with no SAN.
- The page must be in a secure context (HTTPS, or `localhost`) for microphone access.
- A non-`localhost` HTTP origin (for example `http://192.168.1.124:8080`) **blocks the microphone**. That's a CP-6 consideration.

## Open points before CP-6 (lab smoke test)

1. **Secure origin for the Agent Desktop** in the lab: `localhost` port forwarding, the Vite dev server over HTTPS, or a browser flag for testing only. Decision needed.
2. **The FS-CC agent contacts** (ids 1, 2, 303, 3525) still point at `@172.21.20.57`, so **queue calls** to those agents fail (L-10). The softphone itself registers fine (extension comes from the contact, domain from config). The §9b transaction is needed.
3. **The FS-CC backend, frontend and agent PM2 apps aren't running** on Ubuntu-FS; they're needed for CP-6.
4. **Lab checks L-01 to L-16** are still outstanding. The Phase 4 relay (Q15) and `PHONE_OFFLINE` (Phase 5) come later.
5. **`.env.example`** doesn't list the three `VITE_*` WebRTC keys yet (optional documentation follow-up).

## Approval requested

1. Commit and push CP-5 from the laptop (5 code files plus this report), then `git pull --ff-only` on Ubuntu-FS.
2. CP-6 (lab smoke test) as a separate approval, after the open points 1–3 are decided.
