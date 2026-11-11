# Test Strategy

## Where tests run
Laptop `node_modules` is incomplete (no vitest, no rollup Windows binary), so tests run in the WSL **test copy** `/root/test/fs-cc`, never in `/opt/freeswitch-ui/fs-cc` (live DEV).

One-way refresh + full run (script kept in the session scratchpad as `sync_test.sh`; recreate from this description if lost):
1. `rsync -a --delete --exclude node_modules --exclude '.env*' --exclude .git --exclude dist /mnt/c/Users/naresh/Documents/fs-cc/ /root/test/fs-cc/`
2. strip CRLF from source files
3. copy `node_modules` once from the live tree (read-only use of `/opt`)
4. run: backend `npx vitest run` · agent-desktop `npx vitest run`, `npm run typecheck`, `vite build` (phone on) · frontend `vite build`

## Suites
| Suite | Count (cycle 1 end) |
|---|---|
| backend unit | 406 |
| agent-desktop unit/component | 185 |
| frontend | 0 (TEST-1) |

## Rules
- Baseline failures are fixed at the root or recorded; never deleted or weakened.
- Telephony tests use mocks; real-call checks are done by the owner and recorded with date.
- No test touches the live DEV database or FreeSWITCH. An isolated test database (`fs_cc_test`) is the next step for API integration tests (needs owner OK: it creates a database on the shared PostgreSQL).
