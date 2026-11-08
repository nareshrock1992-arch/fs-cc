# Development Workflow: Laptop → Ubuntu-FS test → GitHub

Agreed with the owner on 2026-11-08. It applies to FS-CC, and to FS-ENRS and FS-WebRTC when they are changed.

## In one picture

```
 ┌──────────────────────────┐   1. write code (no commit)
 │ Windows laptop           │
 │ Documents\fs-cc          │──── 2. copy working tree (read-only, via /mnt/c) ───┐
 │ = THE source of truth    │                                                     ▼
 └──────────────────────────┘                                   ┌──────────────────────────────┐
            ▲   │                                                │ Ubuntu-FS scratch copy       │
            │   │ 5. commit + push (only after                   │ /root/test/fs-cc             │
            │   │    the owner approves)                         │ 3. npm ci · typecheck ·      │
            │   ▼                                                │    tests · build             │
            │ ┌───────────┐                                      └──────────────┬───────────────┘
            │ │  GitHub   │                                                     │
            │ └─────┬─────┘                                    4. all green? ───┘
            │       │ 6. git pull                              show results to the owner
            │       ▼
            │ ┌──────────────────────────────┐
            └─│ Ubuntu-FS real repo          │  build / run only
              │ /opt/freeswitch-ui/fs-cc     │  (never edited or committed here)
              └──────────────────────────────┘
```

## The rules

1. **The laptop is the only place code is written and committed.**
2. **Ubuntu-FS never authors commits.** Its real repo only receives `git pull`.
3. **Tests run in a throwaway copy** (`/root/test/fs-cc`), never in `/opt/freeswitch-ui/fs-cc`.
4. **Nothing is pushed until the owner approves**, after seeing green results and the change list.
5. **Never copied:** `node_modules`, `dist`, `.env*`, `.git`, secrets.
6. **No force-push. No direct changes to `main`.** Work happens on a feature branch.

## Step by step

### Step 1: write the change on the laptop
Edit files in `C:\Users\naresh\Documents\fs-cc` on the current feature branch (for example `feature/webrtc-agent-desktop-phase2`). **Do not commit yet.**

### Step 2: copy the laptop working tree into the scratch folder
In Ubuntu-FS, as root:
```bash
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude '.env*' --exclude .git \
  /mnt/c/Users/naresh/Documents/fs-cc/ /root/test/fs-cc/
```
- This reads the laptop files and never changes them.
- `--delete` only affects the scratch folder. It keeps the scratch copy an exact mirror of the laptop.
- `rsync` excludes are relative to the source root, so these patterns also match inside sub-folders.

### Step 3: install and check (agent-desktop example)
```bash
export PATH=/root/.local/node-v22.23.4/bin:$PATH     # Node 22.23.4 (system Node stays 22.22.1)
cd /root/test/fs-cc/agent-desktop
npm ci                    # exact versions from package-lock.json
npm run typecheck         # strict TypeScript check of the softphone feature
npm test                  # unit tests (vitest + jsdom)
npm run build             # production build must still succeed
```
**Line endings (important):** some laptop files have CRLF line endings. Git normalises them to LF on commit (`core.autocrlf=input`), but a plain copy keeps CRLF, and that **changes the build output** (CR characters end up inside JSX template strings). So after the copy, normalise the scratch copy only:
```bash
find /root/test/fs-cc -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.json' -o -name '*.css' -o -name '*.html' -o -name '*.md' \) \
  -not -path '*/node_modules/*' -exec grep -lI $'\r' {} + | while read f; do sed -i 's/\r$//' "$f"; done
```
**Tailwind note:** Tailwind scans every `src/**/*.{js,jsx}` file, tests included. A word in a test that happens to be a utility class name (for example `container`) adds CSS to the bundle. Compare the build size with the previous checkpoint.

### Step 4: green or not?
- **Any failure:** fix on the laptop, then repeat Steps 2–3.
- **All green:** report to the owner:
  - the list of changed files and a short diff summary;
  - typecheck, test (count) and build results, compared with the previous checkpoint;
  - anything unexpected.

### Step 5: commit and push, on approval only
On the laptop:
```bash
git add <only the intended files>
git commit -m "<clear message>"
git push origin <feature-branch>      # normal push, never --force
git ls-remote origin <feature-branch> # confirm the remote commit
```

### Step 6: update the real Ubuntu-FS repo
```bash
cd /opt/freeswitch-ui/fs-cc
git pull --ff-only
export PATH=/root/.local/node-v22.23.4/bin:$PATH
cd agent-desktop && npm ci && npm run build   # only if dependencies or the build changed
```
`--ff-only` refuses to merge if anything unexpected is there. If it refuses, **stop and ask**.

## Quick reference

| Task | Where | Command |
|---|---|---|
| Write code | Laptop | editor, no commit |
| Mirror for testing | Ubuntu-FS | `rsync … /mnt/c/…/fs-cc/ /root/test/fs-cc/` |
| Test | Ubuntu-FS scratch | `npm ci && npm run typecheck && npm test && npm run build` |
| Publish | Laptop | `git commit` + `git push` (after approval) |
| Deploy to Ubuntu-FS | Ubuntu-FS real repo | `git pull --ff-only` |
| Throw away the scratch copy | Ubuntu-FS | `rm -rf /root/test/fs-cc` (safe; it is only a copy) |

## Why this pattern

- **One source of truth:** the laptop. GitHub only gets finished, tested work.
- **Few approvals:** one approval per checkpoint, not one per test run.
- **Safe live environment:** `/opt/freeswitch-ui/fs-cc` (used by PM2) only changes when tested work is pulled.
- **Linux testing:** tests and builds run on Linux, where the project's packages work. On Windows the build is blocked by the missing Rollup Windows binary.
