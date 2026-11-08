# FS-WebRTC → FS-CC: CP-3 Checkpoint Report

Date: 2026-11-08. Environment: **Ubuntu-FS** `/opt/freeswitch-ui/fs-cc`, branch `feature/webrtc-agent-desktop-phase2`. **CP-4 not started.**

## Phase 1: laptop commit and push

- **Branch / commit:** `feature/webrtc-agent-desktop-phase2`, created from `main` @ `f560dd7`. Commit **`a7c2938f649ca9d729056ad55b4515d00dca32d6`** (author Naresh, co-authored). Pushed normally, **no force**. `main` unchanged locally and on GitHub (`f560dd7`).
- **Committed (11 files):**
  - `agent-desktop/package.json` (CP-2; normalised to LF)
  - `agent-desktop/package-lock.json` (`f90adbea…5100bb2`)
  - `agent-desktop/tsconfig.json`
  - `agent-desktop/vitest.config.js`
  - `docs/enterprise/` × 7: feasibility audit, readiness, test baseline, Phase 2 plan, WSL assessment, Ubuntu-FS migration plan, CP-3 sync plan
- **Excluded (Git-ignored, confirmed):** `.env`, `agent-desktop/.env`, `backend/.env`, `frontend/.env`, `node_modules/` (×3), `dist/` (×2).
- **Secret scan before the commit:**
  - The Phase 2 plan contained the lab password in plain text. It was **redacted** before the commit ("value intentionally not recorded").
  - The feasibility audit quotes FS-CC's public example defaults (`ClueCon`, `changeme`) from the code. These are not secrets and were kept.
- **Remote verified:** `git ls-remote` gives `a7c2938`; 11 paths on the remote branch; the remote lockfile SHA-256 = `f90adbea…`.

## Phase 2: Ubuntu-FS synchronisation

- **Before:** `main` @ `f560dd7`. Untracked: an old `agent-desktop/package-lock.json` (`c1c6083e…`) and `frontend/src/.index.css.swo`. No stash.
- **Backup:** `/root/backups/20261108-075947-cp3-sync/` (mode 700)
  - the old lockfile (copy, and the moved original)
  - `status-before.txt`
  - `MANIFEST.sha256`
  - The `.swo` copy didn't happen. The file itself was **not touched** and is still in place.
- **Change:** the old lockfile was moved into the backup, because it would block the checkout. Then `git fetch` and `git checkout -b … --track origin/feature/webrtc-agent-desktop-phase2`.
- **HEAD:** `a7c2938…`, **matches GitHub**.
- **After:** only `?? frontend/src/.index.css.swo` remains untracked. No unrelated file was lost.

## Phase 3: CP-2 environment readiness

| Item | Result |
|---|---|
| System Node / npm | `/usr/bin/node` **v22.22.1** / npm 9.2.0. **Unchanged** |
| Local Node | **v22.23.4** / npm 10.9.9 in `/root/.local/node-v22.23.4`. Tarball verified against nodejs.org `SHASUMS256.txt`. Used only through `PATH` for agent-desktop builds and tests (the repository is root-owned) |
| `npm ci` | 187 packages; **lockfile unchanged** (`f90adbea…` before and after) |
| Build | `index-SL2wqdVl.js` 236.37 kB, `index-90arXMMA.css` 21.31 kB: **identical to the CP-2 baseline** |
| `npm test` | exit 0 (no tests yet; `passWithNoTests`) |
| `npm run typecheck` | TS18003 "No inputs", **expected** before CP-3 |

## Phase 4: CP-3 (engine copy)

- **Source:** `https://github.com/nareshrock1992-arch/FS-WEBRTC` @ `23ab1ce682489b4cded330286f0f4235a440da11`, using `git archive`.
- **Destination:** `agent-desktop/src/features/softphone/engine/`, with the approved layout `engine/src/…` and `engine/tests/unit/…`.
- **Files copied (19):**
  - `src/audio/{devices,remote-audio,ringtone}.ts`
  - `src/config/config.ts`
  - `src/services/{call-state,phone-service,reconnect,store}.ts`
  - `src/sip/{call-session,sip-client}.ts`
  - `src/types/phone.ts`
  - `src/utils/{logger,time,validation}.ts`
  - `src/vite-env.d.ts`
  - `tests/unit/{call-state,logger-time-store,reconnect,validation}.test.ts`
  - (The sync plan said "18 files" in the engine directories; the correct count is 14 + `vite-env.d.ts` + 4 tests = **19**.)
- **Excluded:** the vanilla UI (`main.ts`, `pages`, `components`, `styles`), `server/*`, `sip-via.test.ts` (Phase 4).
- **SHA-256 verification:** for every file, the hash of `git show 23ab1ce:<path>` equals the hash of the copied file. **BYTE-IDENTICAL: 19/19**, no CRLF. Full hash list in `agent-desktop/src/features/softphone/SOURCE.md`.
- **Local changes to the engine:** none. **No configuration change was needed:** the existing `tsconfig.json` and `vitest.config.js` already cover these paths.

| Check | Result | vs. CP-2 baseline |
|---|---|---|
| `npm run typecheck` (strict tsc, engine and tests) | **exit 0, no errors** | was TS18003 "no inputs" (expected) |
| `npm test` | **4 files, 64 tests passed**: validation 41, reconnect 6, call-state 8, logger-time-store 9 | was 0 tests |
| `npm run build` | `index-SL2wqdVl.js` 236.37 kB, `index-90arXMMA.css` 21.31 kB | **identical**: the engine isn't imported by the app yet, so the bundle is unchanged |
| Lockfile | `f90adbea…` | unchanged |

**Working tree:** the CP-3 files are **uncommitted** (19 engine files, `SOURCE.md` and this report), plus the pre-existing `.swo`. No business logic, FS-ENRS, backend or frontend change.

## Remaining issues and notes

1. **CP-3 is not committed.** It needs approval to commit and push on the branch from Ubuntu-FS. Git identity: pass `-c user.name/-c user.email` as before.
2. **The laptop copy is now behind Ubuntu-FS** for CP-3. Ubuntu-FS is the working copy; the laptop branch only holds `a7c2938`.
3. **`dist/` was rebuilt** in Ubuntu-FS `agent-desktop`. It is Git-ignored, and the build output is the same as before.
4. **Build commands for the agent desktop must use the local Node** (`export PATH=/root/.local/node-v22.23.4/bin:$PATH`). The PM2 `fs-agent` app (Vite dev server) still uses system Node 22.22.1, which runs Vite correctly. Only jsdom tests need ≥ 22.22.2.
5. **Still open before CP-4:**
   - questions U-1 to U-6 in the Phase 2 plan;
   - Phase 4 relay (the `sip-via` test, `server/*`);
   - the `PHONE_OFFLINE` server path (Phase 5);
   - FS-CC agent contacts (still `@172.21.20.57`);
   - lab checks L-01 to L-16.

   The new LAN server `192.168.1.124` can serve as the lab target for the CP-6 smoke test.
6. **Not done here, as instructed:** no deployment, no CP-4, no FS-ENRS changes.

**Request:** explicit approval for (a) committing and pushing CP-3 on the branch, and (b) starting CP-4.
