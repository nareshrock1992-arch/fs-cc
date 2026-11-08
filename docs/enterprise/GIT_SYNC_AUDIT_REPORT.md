# Git synchronization audit: FS-ENRS and FS-CC

Date: 2026-11-08. Standard now in force for both repositories:

```
Laptop working tree  →  GitHub origin/main  →  Ubuntu-FS / other servers
```
Routine server update: `git pull --ff-only origin main`. Never edit, commit or push on a server.

## Final state

| | FS-ENRS | FS-CC |
|---|---|---|
| Repository | `github.com/nareshrock1992-arch/fs-enrs` | `github.com/nareshrock1992-arch/fs-cc` |
| Laptop folder / branch | `Documents\fs-enrs` on `main` | `Documents\fs-cc` on `main` |
| Final commit (laptop = GitHub = Ubuntu-FS) | `bec05e2` | `7fb0518` |
| Previous `origin/main` | `6ab4dc6` | `f560dd7` |
| How `main` moved | fast-forward to `fix/tenant-unification` (+ .gitignore commit). No merge, no force | fast-forward to `feature/webrtc-agent-desktop-phase2` (+ .gitignore commit). No merge, no force |
| Work now on `main` | Contacts (enterprise management, audit log, Excel import template, international-number fix), Tenant unification (ERS/IVR, SUPER_ADMIN tenant IVRs), media library/safety, reporting hardening | WebRTC Agent Desktop CP-1 to CP-5, HTTPS dev option, WebRTC production runbook |
| Laptop working tree | clean | clean (this report aside) |
| Ubuntu-FS (`/opt/freeswitch-ui/…`) | on `main`, `0 0` vs `origin/main`, clean | on `main`, `0 0` vs `origin/main`, clean |

Older side branches are fully contained in `main`: FS-ENRS `feature/media-reporting-hardening`, `media-safety-remediation`; FS-CC `feature/ui-modernization`. They can be deleted later (optional).

## Machine-specific file protection

- **Laptop:** no secret, certificate, database or log file is tracked in either repository.
- **New `.gitignore` rules** (each checked to hide no tracked file):
  - FS-ENRS: `.env.*` (keeps `!.env.example`), `*.bak*`, `*.pem`, `*.key`, `*.swp`/`*.swo`, `/*.wav`, `backend/uploads/`, `backups/`, `.claude/settings.local.json`.
  - FS-CC: `*.swo`, `*.pem`, `*.key`, `*.bak*`, `backups/` (it already ignored `.env` and `.env.*`).
- **Ubuntu-FS FS-ENRS** had `backend/.env` and `frontend/.env` tracked. Before the pull:
  1. Backed up both `.env` files and both `package-lock.json` files to `/root/backups/20261108-144227-git-sync-fs-enrs/` (mode 700/600).
  2. `git rm --cached` on both `.env` files (index only; files kept).
  3. Restored both lockfiles to the committed version (server copies are in the backup).
  4. `git pull --ff-only origin main`.

  Verified afterwards: both `.env` files are byte-identical to before (SHA-256) and are now ignored. Server prompt recordings (`*.wav`), `backend/uploads/`, `.env.bak*` and logs are now ignored, so they show as neither changed nor untracked.
- **Ubuntu-FS FS-CC:** `agent-desktop/.env.local` and `backend/.env` preserved.
- No services were restarted.

## Tests

| Suite | Result |
|---|---|
| FS-CC Agent Desktop | 103 / 103 passed (code unchanged since `ba76c00`; later commits are docs/.gitignore) |
| FS-ENRS frontend | 335 / 335 passed (throwaway copy `/root/test/fs-enrs`) |
| FS-ENRS backend unit | 1,926 passed, **24 failed** (see below) |
| FS-ENRS backend integration | not runnable in the throwaway copy (needs the real database) |

## Outstanding issues

1. **FS-ENRS failing unit tests (owner chose to continue).**
   - Files whose code did not change in this sync: `varsParser`, `sofiaProvider`, `switchConfParser`, `gatewayFileProvider`, `conferenceProvider`, `infrastructure.eventBus`. Likely pre-existing.
   - Files touching code changed on the branch: `ersCallerNamePresentation` (8; the tests read `ersRingService.js` source text, which is committed with CRLF line endings), `xmlGenerator`, `ivrCycle3Boundaries`. To investigate as a separate task.
2. **Old secrets in GitHub history.** FS-ENRS `backend/.env` and `frontend/.env` were committed before `75d28e1`. Their old values remain in history. Recommended: change the database, JWT and ESL credentials they contained. Removing them from history would need a force-push (not done).
3. **FS-ENRS on Ubuntu-FS is running older code.** The pull changed files on disk only. The backend keeps running old code until restarted, and new database migrations have not been run. The frontend Vite dev server serves the new frontend files immediately. Plan the migrations and a restart together.
4. **Stale clone** `Documents\fs-cp\fs-enrs` (97 commits behind, 95 modified and 107 untracked files). Not touched; owner to review before deleting.
5. **Line endings.** Some FS-ENRS files are committed with CRLF. A `.gitattributes` (`* text=auto eol=lf`) would stop this recurring; separate change.
6. Throwaway test copies `/root/test/fs-enrs` and `/root/test/fs-enrs-main` can be deleted.
