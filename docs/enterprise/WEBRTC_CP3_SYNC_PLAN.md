# FS-WebRTC → FS-CC: Synchronisation Plan before CP-3 (proposal, not executed)

Date: 2026-11-08. Phases 0–1 only. **No file was copied or overwritten.**

## 1. Phase 0 findings (read-only)

### Windows laptop: `C:\Users\naresh\Documents\fs-cc`
- **Branch / HEAD:** `main` @ `f560dd7`, equal to `origin/main`.

| File | Status | SHA-256 | Note |
|---|---|---|---|
| `agent-desktop/package.json` | **M** (CP-2) | `60a8c5c94df98afa192f717ae9ad785373aed3887e0c15318356c445d3bc87cd` (CRLF working copy) | +`typecheck`/`test` scripts; +`sip.js 0.21.2`; +`typescript 6.0.3`, `vitest 5.1.0`, `jsdom 31.0.0`. The working copy has **CRLF**; Git stores LF |
| `agent-desktop/package-lock.json` | ?? (CP-1, replaced in CP-2) | `f90adbeaef2d7a11e451be698bd41cb049c6e428e8d616b280002cd5c5100bb2` | lockfile v3; the CP-2 verified hash |
| `agent-desktop/tsconfig.json` | ?? (CP-2) | `4bda71f4c9e82da3d114d3f190b42e60c31929521a13830110cb35ffd9b719d0` | strict; `include src/features/softphone/**/*.ts` |
| `agent-desktop/vitest.config.js` | ?? (CP-2) | `49336f5a9fcbe82470441212b46a2a1cbbd3ba21cf1288f3f52f2ecf4c874448` | jsdom, `vmThreads`, `passWithNoTests` |
| `docs/enterprise/*.md` | ?? | — | 6 reports: feasibility audit, Phase 2 readiness, plan, test baseline, WSL assessment, Ubuntu-FS migration plan |

### Ubuntu-FS: `/opt/freeswitch-ui/fs-cc` (root-owned)

| Item | Finding |
|---|---|
| Branch / HEAD | `main` @ `f560dd7`, **the same commit** as the laptop |
| `agent-desktop/package.json` | **unchanged from Git** (`cfb27ac7…`). No CP-2 |
| `agent-desktop/package-lock.json` | **untracked, different** (`c1c6083e…`, 90 510 bytes, 2026-10-14). An older local install, lockfile v3. **Conflicts** with the CP-1/CP-2 lockfile |
| `tsconfig.json`, `vitest.config.js` | missing |
| `src/features/` | missing |
| `docs/enterprise/` | missing |
| `node_modules` | present (old install). `sip.js` and `vitest` **not installed** |
| Other untracked | `frontend/src/.index.css.swo` (editor swap file; leave it) |
| Node / npm | **22.22.1** / 9.2.0. **jsdom 31.0.0 needs ≥ 22.22.2** |
| `core.autocrlf` | unset (Linux; LF) |

### FS-WebRTC source
- **Commit:** `C:\Users\naresh\Documents\fs-webrtc` @ `23ab1ce682489b4cded330286f0f4235a440da11`, clean, equal to origin.
- **Engine (R-1):**
  - `src/{audio,config,services,sip,types,utils}/**`: 18 files
  - plus `src/vite-env.d.ts`, which types `VITE_SIP_DOMAIN`/`VITE_SIP_WSS_URL`; strict typecheck needs it
- **Not copied:** the vanilla UI (`src/main.ts`, `src/pages/*`, `src/components/*`, `src/styles/app.css`) and `server/*` (Phase 4).
- **Tests:** `tests/unit/{call-state,logger-time-store,reconnect,validation}.test.ts`. `sip-via.test.ts` imports `../../server/sip-via.mjs`, so it is excluded and moved to Phase 4.

**Layout issue found.** The tests import `'../../src/<area>/…'`. With the plan's layout (`engine/services/…`, tests in `__tests__/`), those imports would break, and the tests could not stay byte-identical. **Proposed fix:** mirror the source layout inside `engine/`:
```
agent-desktop/src/features/softphone/
  SOURCE.md
  engine/
    src/   audio/ config/ services/ sip/ types/ utils/ vite-env.d.ts   (byte-identical)
    tests/unit/  call-state, logger-time-store, reconnect, validation .test.ts (byte-identical)
```
- Every relative import then resolves unchanged.
- The existing `tsconfig.json` (`src/features/softphone/**/*.ts`) and `vitest.config.js` (`src/features/softphone/**/*.test.*`) already cover these paths, so **no config change** is needed.
- The only deviation from the plan is one extra `src/` level.

## 2. Phase 1: synchronisation plan (needs approval)

**Method (recommended): copy files directly, without Git.**
- Copy from the laptop into Ubuntu-FS via `/mnt/c`, as root.
- Back up every overwritten file first, to `/root/backups/<stamp>-cp3-sync/`.
- No commit or push.
- **Alternative:** commit CP-1/CP-2 and the docs on a laptop branch, push, then fetch and check out on Ubuntu-FS. That needs commit/push approval.

| # | Source (laptop) | Destination (Ubuntu-FS) | Action |
|---|---|---|---|
| S-1 | `agent-desktop/package.json` | same path | back up the current file, then copy **converted to LF**. Verify the content equals the laptop file apart from line endings |
| S-2 | `agent-desktop/package-lock.json` (`f90adbea…`) | same path | back up the current untracked lockfile (`c1c6083e…`), then replace it. Verify SHA-256 = `f90adbea…` |
| S-3 | `agent-desktop/tsconfig.json` | same path | copy (new). Verify the hash |
| S-4 | `agent-desktop/vitest.config.js` | same path | copy (new). Verify the hash |
| S-5 | `docs/enterprise/*.md` (7, including this plan) | `docs/enterprise/` | copy (new) |

**Not copied:** `node_modules`, `dist`, any `.env*`, `.claude/`, backend and frontend, anything else.
**Not touched:** FS-CC business logic, the `frontend` build configuration, FS-ENRS, `frontend/src/.index.css.swo`.

**After the copy (part of the approval):**
- **S-6:** `npm ci` in `agent-desktop`. It replaces the old `node_modules` with exactly the CP-2 lockfile set, and confirms the lockfile stays unchanged (hash).
  - The `fs-agent` PM2 app uses this folder, but it isn't running.
  - **Rollback:** restore the old lockfile, then `npm ci`.
- **S-7: Node decision, needed before tests:**
  - **(a) Recommended:** a user-local Node ≥ 22.22.2 (for example the same 22.23.4 that was checksum-verified in the `Ubuntu` distro for CP-2), only on the `PATH` used for agent-desktop builds and tests. System `/usr/bin/node` 22.22.1 is untouched.
  - **(b)** Use the system 22.22.1: `npm ci` warns (EBADENGINE), and jsdom-based tests may fail. That would not be a valid baseline.
- **S-8:** re-establish the CP-2 baseline on Ubuntu-FS before CP-3:
  - `npm run build` should give the same asset names and sizes as CP-2 (`index-SL2wqdVl.js` 236.37 kB, `index-90arXMMA.css` 21.31 kB);
  - `npm test` exits 0 (no tests yet);
  - `npm run typecheck` gives TS18003 "No inputs" (expected until CP-3).

## 3. CP-3, after approval (unchanged from the request)

1. `git -C fs-webrtc archive 23ab1ce src/{audio,config,services,sip,types,utils} src/vite-env.d.ts tests/unit/{call-state,logger-time-store,reconnect,validation}.test.ts`, extracted into `softphone/engine/` with the layout above. Byte-identical: no line-ending conversion, because the files are taken from the Git object.
2. `SOURCE.md`: repository URL, commit, list of files with SHA-256, exclusions and their reasons, local changes (**none**).
3. Run `npm run typecheck`, `npm test` (the 4 engine test files) and `npm run build` (bundle unchanged: the engine isn't imported anywhere yet), and compare with the S-8 baseline.
4. Stop. No CP-4.

## 4. Approvals requested

| ID | Approval |
|---|---|
| A | Sync S-1 to S-5 by direct copy (or the Git-branch alternative) |
| B | S-6: `npm ci` in Ubuntu-FS `agent-desktop` |
| C | S-7: user-local Node ≥ 22.22.2 for `user`/root build use (option a) |
| D | The engine layout deviation (`engine/src/…`, `engine/tests/unit/…`) |
| E | Then CP-3 itself |
