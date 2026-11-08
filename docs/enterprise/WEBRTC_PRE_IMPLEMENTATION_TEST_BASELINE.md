# FS-CC — WebRTC Pre-Implementation Test Baseline

Date: 2026-11-07. Task: repository readiness before Phase 2. **Phase 2 has not started.**

## 1. What was measured

| Item | Value |
|---|---|
| Repository | `C:\Users\naresh\Documents\fs-cc` (`github.com/nareshrock1992-arch/fs-cc`) |
| Branch / HEAD | `main` @ `f560dd7de1a5a97baa3f61151f6991b5f848edc3` ("fs-cc UI improvement", 2026-10-14), equal to `origin/main` |
| Throwaway copy | `C:\Users\naresh\AppData\Local\Temp\claude\e636dc8892bc1af1\2817f7de-109c-4b4c-bc1d-334b83d52842\scratchpad\fscc-baseline` |
| How the copy was made | `git archive HEAD` (only committed files, no `.env`), plus a copy of the existing `node_modules` of `backend`, `frontend`, `agent-desktop` |
| Original working tree | not touched by the test run (only `docs/enterprise/` untracked, before and after) |
| Database / services | none used. No `.env` in the copy, no migration, no DEV or production connection |
| Environment | Windows 10 Pro 19045, Node v26.13.0, npm 11.20.0 |

## 2. Available checks (from `package.json`)

| Package | Scripts | Automated tests | Lint |
|---|---|---|---|
| `backend` | `start`, `dev`, `db:init`, `test` (`vitest run`), `test:watch` | 32 test files (`vitest.config.js`) | none configured |
| `frontend` | `dev`, `build`, `preview` | none | none configured |
| `agent-desktop` | `dev`, `build`, `preview` | none | none configured; **no lockfile** |

## 3. Results

| Suite | Command (in the copy) | Result | Counts | Duration |
|---|---|---|---|---|
| Backend unit tests | `cd backend && npx vitest run` | **PASS** | files 32/32; tests **396 passed, 0 failed, 0 skipped, 396 total** | 8.66 s (vitest), 13 s wall |
| Frontend build | `cd frontend && node node_modules/vite/bin/vite.js build` | **BLOCKED (environment)** | n/a | 1 s |
| Agent-desktop build | `cd agent-desktop && node node_modules/vite/bin/vite.js build` | **BLOCKED (environment)** | n/a | 1 s |
| Lint | — | not available (no lint script or config) | n/a | n/a |
| E2E / integration with FreeSWITCH, PostgreSQL | — | **not run** (no services on this laptop; out of scope) | n/a | n/a |

### Environment limitations (not application failures)

1. **Backend test runner version.** `backend/node_modules` on this laptop does not contain `vitest`
   (declared `^1.6.0`). `npx` therefore fetched **vitest 5.1.0** into the npm cache (not into the
   project) to run the suite. The 396/396 result is valid evidence that the tests pass, but it was run
   with a newer major version than the project declares. A baseline with the declared 1.6.x should be
   repeated on a machine with a complete `npm ci`.
2. **Frontend builds.** Both `frontend` and `agent-desktop` `node_modules` were installed on Linux:
   `@rollup/` contains only `rollup-linux-x64-gnu` / `-musl`. Vite 5.4.21 fails at once with
   `Cannot find module @rollup/rollup-win32-x64-msvc`. No packages were installed to work around it
   (not allowed in this task). The builds must be checked on Linux/WSL or after a Windows `npm ci`.

### Pre-existing failures

None observed in the suites that could run.

## 4. How to reproduce

```bash
git -C /c/Users/naresh/Documents/fs-cc archive --format=tar f560dd7 | tar -x -C <empty folder>
cd <folder>/backend && npm ci && npx vitest run      # expect 32 files / 396 tests passing
cd ../frontend && npm ci && npx vite build
cd ../agent-desktop && npm install && npx vite build # no lockfile yet
```

Phase 2 changes must keep backend at **396 passed / 0 failed** (plus any new tests), and both builds must
succeed on a clean install.
