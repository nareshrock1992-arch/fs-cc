# FS-WebRTC → FS-CC — Phase 2 Readiness

Date: 2026-11-07. Repository-readiness task only. Architecture decisions Q10, Q10a, Q13, Q14, Q15, agent-entered
SIP password, and hybrid phone model are settled (see `WEBRTC_AGENT_DESKTOP_FEASIBILITY_AUDIT.md` §22.00) and
were not reopened.

## A. Executive status

**READY WITH DOCUMENTED LIMITATIONS**

The repositories are protected, configured and baselined. The limitations: the frontend builds could not
be verified on this laptop, because the dependencies were installed for Linux. All lab checks are still
outstanding, which the plan allows during Phases 2–4.

## B. Prerequisite closure

| Prerequisite | Status | Evidence | Remaining action |
|---|---|---|---|
| FS-CC test baseline | **Closed, with a limitation** | Backend 396/396 pass at `f560dd7` in a throwaway copy (`WEBRTC_PRE_IMPLEMENTATION_TEST_BASELINE.md`) | Re-run the frontend and agent-desktop builds, and backend with the declared vitest 1.6.x, on a clean `npm ci` (Linux/WSL) |
| Git line-ending configuration | **Closed** | FS-CC local `core.autocrlf` is now `input` (previously unset, inheriting system `true`) | None |
| FS-ENRS documentation protection | **Closed** | Local commit `63977bf`, 5 docs only, not pushed | Push when the owner decides |
| FS-CP folder decision | **Recommendation made** | §F | Owner decision. No folder was changed |
| Lab validation schedule | **Prepared** | §G | Run the checks during Phases 2–4 |

### Line-ending detail (Phase C)

- **Global:** unset. **System:** `core.autocrlf=true` (`C:/Program Files/Git/etc/gitconfig`, read only; not changed).
- **FS-CC local:** unset before; now `core.autocrlf=input` (`git config --local core.autocrlf input`).
- **`.gitattributes`:** none in FS-CC.
- **Files:** `git ls-files --eol` shows all 188 tracked files stored with LF. In the working tree, 175 files are LF and 13 are CRLF (for example `ecosystem.config.js` and `agent-desktop/src/pages/Dashboard.jsx`).
- **Why `input`:**
  - The repository is LF and is deployed to Linux.
  - With `input`, Git keeps CRLF out of new commits and does not convert files on checkout.
  - The 13 CRLF working files still read as unchanged, because Git normalises them on add.
  - `false` would make those 13 files show as modified.
- **Verification:**
  - `git status --porcelain` was identical before and after the change (only `?? docs/enterprise/`).
  - The line-ending counts were unchanged.
  - No file was converted.
- **Follow-up, optional and separate:** add a `.gitattributes` (`* text=auto eol=lf`) in a reviewed commit.

## C. Repository integrity (final state)

| Repo | Branch | HEAD | Working tree | Local-only commits |
|---|---|---|---|---|
| fs-cc | `main` (= origin) | `f560dd7` | `?? docs/enterprise/`: the WebRTC reports, uncommitted | none |
| fs-enrs | `fix/tenant-unification` | `63977bf` | `?? .claude/settings.local.json` (tool settings, intentionally left) | **1 ahead**: `63977bf`, not pushed |
| fs-webrtc | `main` (= origin) | `23ab1ce` | clean (local `core.autocrlf=false`) | none |

## D. Test baseline

- **Backend:** 32 files; 396 tests passed, 0 failed, 0 skipped. Run with vitest 5.1.0 via npx, because the local `node_modules` lacks vitest.
- **Frontend and agent-desktop builds:** blocked by the environment (missing `@rollup/rollup-win32-x64-msvc`).
- **Lint:** none configured.
- **Pre-existing failures:** none observed.

## E. Documentation commit (FS-ENRS)

**Commit:** `63977bfe82b895d662dfb1af7f036bd7689cff27` on `fix/tenant-unification`:
"docs(enterprise): record migration 051 readiness, DEV deployment and Excel template audit". It changes 5 files (+540 / −2) and **was not pushed**.

| Document | Git status before | Purpose | Laptop-only evidence | Decision |
|---|---|---|---|---|
| `DEV_MIGRATION_051_READINESS.md` | untracked | Readiness audit for migration 051 | absent from every local and remote-tracking ref | Committed |
| `DEV_MIGRATION_051_FINAL_COMPATIBILITY_REVIEW.md` | untracked | Compatibility review | same | Committed |
| `DEV_MIGRATION_051_DEPLOYMENT_REPORT.md` | untracked | DEV deployment record | same | Committed |
| `EMERGENCY_CONTACTS_EXCEL_TEMPLATE_AUDIT.md` | staged (A) | Phase 1 audit for the Excel template, which shipped in `14d057e` | same | Committed as a historical record |
| `MOBILE_IDENTITY_SCOPE_REVIEW.md` | modified (+8/−2) | Adds the delivery record for `6f4aa5d` | committed version lacks these rows | Committed |
| `.claude/settings.local.json` | untracked | local tool settings, not documentation | n/a | **Not committed** |

**Safeguards:**
- **Secret scan:** no passwords, tokens, keys or connection strings were found. One line notes that the smoke-test passwords were "not recorded". Only `127.0.0.1` addresses appear.
- **Staged-diff check:** only `docs/` paths were staged.
- **Author identity:** taken from the existing commits (`Naresh`). It was passed on the commit command only; no Git config was changed.

**Correction to the feasibility audit:** `Documents\fs-cp\fs-enrs` is **15 commits behind** its `origin/main`. It is not 15 commits ahead, so it has no unpushed commits.

## F. FS-CP recommendation (nothing was changed)

| Path | Git state | Relationship | Unique content | Recommendation |
|---|---|---|---|---|
| `C:\Users\naresh\Documents\fs-cp` | monorepo `fs-cp`, `main` @ `cb81d36` (2026-09-17), = origin; **84 modified, 2 deleted, 69 untracked** | older monorepo that predates the split into fs-cc and fs-enrs | `fs-cc/backend` differs from current fs-cc in only 6 paths. Migrations 009–011 are identical in fs-cc; 008 differs. Its deploy files (`deploy/`, `DEPLOYMENT_NOTES.md`, `FS-CP-GOVERNANCE.md`) may be unique | **Reconcile**: review the uncommitted deploy work and migration 008 against the current repos, then **archive later**. Remove only after separate approval |
| `C:\Users\naresh\Documents\fs-cp\fs-enrs` | nested repo `fs-enrs`, `main` @ `cea22e5` (2026-08-09), **15 behind** origin; 95 modified, 69 untracked | same history as current fs-enrs; its HEAD is an ancestor | old phase reports (`PHASE_3B_*`, `PHASE_3C_*`) and `Lua-scripts/legacy/` may be unique | **Reconcile** the docs and Lua items worth keeping into fs-enrs, then archive later |
| `C:\Users\naresh\Documents\Others\DontTouchthisfloder\fs-cp` | `fs-cp`, `main` @ `326a36b` (2026-08-07), = origin; 9 modified, 2 untracked, **including a tracked `deploy/.env`** (contents not read) | oldest snapshot | `deploy/scripts/validate-deployment.sh` | **Retain in place**, as its name asks. Make sure its `deploy/.env` is never committed or pushed |

None of these folders is authoritative. The authoritative repositories are `Documents\fs-cc`, `Documents\fs-enrs` and `Documents\fs-webrtc`.

## G. Lab validation schedule (Phases 2–4)

Nothing in this table has been run; all checks are **outstanding**. Each check runs on the lab FreeSWITCH server 192.168.1.133 only, using the lab test users 7990001 and 7990002 (or new lab-only users). Evidence means relevant `sofia status profile internal reg` output, `fs_cli` event logs, browser console and network (WS) traces, and FS-CC/ENRS log lines, with no secrets.

| ID | Question | Setup | Procedure | Expected and pass criteria | Phase | Blocks release |
|---|---|---|---|---|---|---|
| L-01 | Registration on the internal profile through the relay | relay in lab build | Register 7990001 from the desk | `200 OK`; listed in `reg` output; registration expires in 300 s | 2–3 | Yes |
| L-02 | Multiple registrations for one extension | desk phone and browser on the same extension | Register both; place a queue call | Matches the `multiple-registrations` setting, and the behaviour is documented. Pass if the result is what Q14/R-x requires | 3 | Yes |
| L-03 | Unregister when the WebSocket closes | registered browser | Close the tab, kill the network, then close the socket cleanly | Time until the `reg` entry disappears is recorded for each case, plus whether `sofia::unregister` or `sofia::expire` fires | 3 | Yes |
| L-04 | Detection of registration loss | as L-03 | Measure from the event to the FS-CC reaction | FS-CC detects the loss within the recorded bound | 4 | Yes |
| L-05 | 15-second grace window | relay with ping | Drop for 10 s, then for 20 s | 10 s: no status change. 20 s: On Break `PHONE_OFFLINE` | 4 | Yes |
| L-06 | Renewal every 300 s | registered browser | Watch for 15 minutes or more | Re-REGISTER before expiry; no gap in the `reg` output | 3 | Yes |
| L-07 | Production SIP password format | samples of the password policy (not real values) | Register lab users whose passwords use the same character classes and length | Digest authentication succeeds; no encoding issue | 2–3 | Yes |
| L-08 | Restricting registration to the relay | per-user `auth-acl` in the lab | Register directly on 7443/5066 from outside the relay | Rejected if feasible; otherwise documented as a residual risk | 4 | No (decision required) |
| L-09 | Isolation of desk phones and gateway agents | one desk-phone agent and one gateway agent | Exercise WebRTC agents alongside them | Desk-phone and gateway contacts, registrations and calls are unchanged | 3–4 | Yes |
| L-10 | Queue call to a WebRTC agent | WebRTC agent Available | Call the queue | Rings in the browser; two-way audio; correct CDR | 3 | Yes |
| L-11 | Queue call to desk-phone and gateway agents | existing agents | Call the queue | Behaviour identical to the baseline | 3–4 | Yes |
| L-12 | `PHONE_OFFLINE` handling | WebRTC agent Available | Force a confirmed loss | On Break with code `PHONE_OFFLINE`; indicator shown; counted separately in break totals | 4 | Yes |
| L-13 | FS-ENRS eligibility during phone-offline | as L-12 | Trigger an ENRS queue event | The agent is not selected (status is not Available); no ENRS change needed | 4 | Yes |
| L-14 | Reconnect with a fresh single-use ticket | relay and ticket service | Break the socket and let the engine reconnect | A new ticket is fetched and used; registration restored | 3 | Yes |
| L-15 | Duplicate device and ticket replay | captured ticket | Reuse a ticket; open a second tab on the same agent | Replay rejected; duplicate handled according to policy | 3 | Yes |
| L-16 | No automatic Available after recovery | agent in `PHONE_OFFLINE` | Restore the network | Phone registers again; the agent **stays** On Break until a manual change | 4 | Yes |

The checks that were already listed in the audit (inventory of what uses ports 5066 and 7443, hold inside a queue bridge, how rejects are reported) also stay open, and they block release.

## H. Phase 2 authorization status

**PHASE 2 IMPLEMENTATION HAS NOT STARTED.**

The repository-readiness prerequisites are closed, apart from the frontend build verification that the environment blocked. Phase 2 (moving the phone engine into FS-CC as an isolated module) may begin in a **separate task**. That task's first action should be a clean `npm ci` for `frontend` and `agent-desktop` on Linux/WSL, or an approved Windows reinstall, followed by recording both builds as part of the baseline.

## Files changed by this task

- `fs-cc` local Git config: `core.autocrlf=input` (a repository-local setting, not a tracked file).
- `fs-cc/docs/enterprise/WEBRTC_PRE_IMPLEMENTATION_TEST_BASELINE.md`: new, uncommitted.
- `fs-cc/docs/enterprise/WEBRTC_PHASE_2_READINESS.md`: new, uncommitted.
- `fs-enrs`: local commit `63977bf` (5 documentation files), not pushed.
- Throwaway copy in the session scratchpad. It sits outside every repository and can be deleted at any time.
