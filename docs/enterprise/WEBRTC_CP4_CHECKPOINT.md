# FS-WebRTC → FS-CC: CP-4 Checkpoint Report

Date: 2026-11-08. Written on the **laptop** (`Documents\fs-cc`, branch `feature/webrtc-agent-desktop-phase2` @ `92c211f`). Tested in the Ubuntu-FS scratch copy `/root/test/fs-cc` (workflow: `DEV_WORKFLOW_LAPTOP_TO_UBUNTU_FS.md`). **Not committed. CP-5 not started.**

## What CP-4 adds (Phase 2 plan steps 2.6 and 2.7)

All new files sit under `agent-desktop/src/features/softphone/`. **No existing file was changed.** Nothing in the app imports the feature yet.

| File | Purpose |
|---|---|
| `adapters/configAdapter.js` | `parseInternalContact()`: extension from the agent's existing contact `user/<ext>@…`, optional `{…}` prefix (Q14). `getSoftphoneEligibility()`: gateway and other non-internal contacts are not eligible. `isWebrtcEnabled()`: only `VITE_WEBRTC_ENABLED === 'true'`. `buildAppConfig()`: `VITE_SIP_DOMAIN` and `VITE_SIP_WSS_URL`, renewal 300 s, no STUN/TURN, **no fallback to the page host**. `buildCredentials()`: extension from the contact, domain and WSS from config (E-5), password only from the caller |
| `adapters/authAdapter.js` | Phase 2 stub: `resolveWssUrl()` returns the configured WSS URL. Phase 4 adds the single-use relay ticket (Q15) |
| `adapters/agentStateAdapter.js` | `describePhoneIndicator()`: engine state → display indicator (off / ok / busy / warn / error). **Display only, no status writes** (PHONE_OFFLINE is Phase 5) |
| `phoneSingleton.js` | Lazy module-level `getPhoneService(config)`: exactly one `PhoneService` per page (R-2, E-2) |
| `PhoneProvider.jsx` | React context. Gets the singleton (never constructs it); **does not log out on unmount** (StrictMode) |
| `usePhone.js` | `useSyncExternalStore` on the engine store. `login(password)` builds credentials from the contact and config; it also exposes `logout`, `dial`, `answer`, `reject`, `hangup`, `toggleMute`, `toggleHold`, `sendDtmf`, the device actions, `unlockAudio`, `clearError`, `available`, `eligibility`, `configError` and `indicator` |
| `index.js` | Public surface: `PhoneProvider`, `usePhone`, `isWebrtcEnabled`, `getSoftphoneEligibility`, `describePhoneIndicator`. The `SoftphonePanel` comes in CP-5 |
| `__tests__/configAdapter.test.js` | 22 tests, including the real contact formats seen in `fs_cc.agents` (with dummy values) |
| `__tests__/agentStateAdapter.test.js` | 1 test (10 assertions) |
| `__tests__/phone.react.test.js` | 9 tests with a fake engine facade and the real engine `Store`: singleton; StrictMode creates one instance; store updates reach React; login passes only the typed password; gateway agent refused; missing config; unmount doesn't log out; hook outside the provider |

Also new: `docs/enterprise/DEV_WORKFLOW_LAPTOP_TO_UBUNTU_FS.md` (the agreed workflow, now with the line-ending and Tailwind notes) and this report.

**The engine is unchanged:** the 19 files are still byte-identical to `23ab1ce`. Tests use a placeholder password, not a real one.

## Results (Ubuntu-FS scratch copy, Node 22.23.4)

| Check | CP-3 | CP-4 |
|---|---|---|
| Lockfile | `f90adbea…` | `f90adbea…` (unchanged, no new dependencies) |
| `npm run typecheck` | exit 0 | **exit 0** |
| `npm test` | 4 files / 64 tests | **7 files / 96 tests, all passed** |
| `npm run build` | `index-SL2wqdVl.js` 236.37 kB, `index-90arXMMA.css` 21.31 kB | **identical**: same file names, **0 bytes differ** from the `/opt` baseline build |

The two `Error: usePhone() must be used inside <PhoneProvider>.` lines in the test log come from the test that checks exactly that error. They are expected.

## Issues found and fixed during testing

1. **A Tailwind side effect.** Tailwind scans `src/**/*.{js,jsx}`, test files included. The word `container` in a test added a `.container` rule (+0.29 kB CSS). Fixed by renaming the test variable to `host`.
2. **Line endings in the scratch copy.** Laptop files with CRLF (pre-existing, for example `Dashboard.jsx`) changed the JS bundle in the scratch build, because the CRs ended up inside template strings. This is not a product change: Git normalises to LF on commit. Fixed in the workflow by normalising the scratch copy to LF after `rsync`. The workflow document has been updated.

## Open points (not part of CP-4)

- **Domain source:** the SIP domain comes **from configuration**, never from the contact. The stored contacts still say `@172.21.20.57` (stale), and that's harmless for the softphone. FS-CC queue routing still needs the four contacts fixed (migration plan §9b).
- **The singleton keeps the first config** for the life of the page. Changing `VITE_*` needs a rebuild anyway.
- **The JSX transform in tests relies on Vitest's default esbuild handling.** `PhoneProvider.jsx` imports `React` explicitly, so it works with either JSX runtime. `vitest.config.js` was not changed.
- **Before CP-5:** decide the default values for `VITE_SIP_DOMAIN` / `VITE_SIP_WSS_URL` in the Agent Desktop env (for the lab: `192.168.1.124` / `wss://192.168.1.124:7443`). The browser also needs a certificate exception for WSS.

## Approval requested

1. Commit and push CP-4 from the laptop on `feature/webrtc-agent-desktop-phase2`. That covers the 10 feature files, `DEV_WORKFLOW_LAPTOP_TO_UBUNTU_FS.md` and this report. Then run `git pull --ff-only` in `/opt/freeswitch-ui/fs-cc`.
2. Then CP-5 (`SoftphonePanel` behind `VITE_WEBRTC_ENABLED`, plus the gated lines in `Dashboard.jsx`), as a separate approval.
