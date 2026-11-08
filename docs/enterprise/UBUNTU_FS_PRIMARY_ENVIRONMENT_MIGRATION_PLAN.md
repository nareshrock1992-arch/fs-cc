# Ubuntu-FS — Primary Development Environment Migration Plan

Date: 2026-11-07. Phase 1, read-only preparation. **Nothing in this plan has been carried out.**
This plan follows on from `WSL_PRIMARY_DEVELOPMENT_ENVIRONMENT_ASSESSMENT.md`.

## 0. Summary

- **Ubuntu-FS stays the primary environment.** FreeSWITCH, PostgreSQL, Redis and Piper are healthy, enabled and running.
- **None of the three apps is running at the moment.** No process listens on ports 4000, 8000, 8080 or 4100. PM2 has a saved list, but nothing restores it at boot (`pm2-root` service: not found).
- **The SIP domain is broken today, and it affects live data.**
  - FreeSWITCH's domain is now `172.25.187.198` (the current WSL IP).
  - 4 of the 5 agent contacts in `fs_cc.agents.contact` still point to `user/<ext>@172.21.20.57`, the old IP.
  - Queue calls to those agents will fail until the domain is fixed.
- **Repositories:**
  - `fs-cc` matches the laptop (`f560dd7`).
  - `fs-enrs` on Ubuntu-FS is on `main` (`6ab4dc6`) with 20 uncommitted entries. The laptop's working branch `fix/tenant-unification` (`63977bf`) is not there.
  - `fs-webrtc` is missing from Ubuntu-FS.
- **Node:** 22.22.1 comes from Ubuntu's own `nodejs` package, with npm 9.2.0. jsdom 31 (added in CP-2) needs ≥ 22.22.2.
- **Side effect of this inventory, please note.** My script printed `pm2 -v` as root. Because no root PM2 daemon was running, this **spawned an empty root PM2 daemon** (PID 1902).
  - It started no apps: ports 4000, 8000, 8080 and 4100 are still closed.
  - The user-level daemon (PID 808, from the earlier assessment) is also still there.
  - Both are harmless. Cleanup needs approval (A-1).
  - The earlier assessment said a root daemon "existed". That was the saved list in `/root/.pm2/dump.pm2`, not a running daemon. This report corrects it.

## 1. Repository inventory

### Windows laptop (`C:\Users\naresh\Documents`)

| Repo | Branch | HEAD | vs origin | Working tree |
|---|---|---|---|---|
| fs-cc | `main` | `f560dd7` | equal | `M agent-desktop/package.json`; untracked `agent-desktop/package-lock.json`, `tsconfig.json`, `vitest.config.js`, `docs/enterprise/` (CP-1, CP-2 and reports) |
| fs-enrs | `fix/tenant-unification` | `63977bf` | equal (pushed) | untracked `.claude/settings.local.json` |
| fs-webrtc | `main` | `23ab1ce` | equal | clean |

Other branches on the laptop:
- **fs-cc:** `feature/ui-modernization` `67bba13`.
- **fs-enrs:** `main` `6ab4dc6`, `feature/media-reporting-hardening` `98fa2c3`, `media-safety-remediation` `7b40b59`.

### Ubuntu-FS (`/opt/freeswitch-ui`)

| Repo | Owner | Branch | HEAD | Working tree | Notes |
|---|---|---|---|---|---|
| fs-cc | root | `main` | `f560dd7` | `?? agent-desktop/package-lock.json`, `?? frontend/src/.index.css.swo` (an editor swap file) | Local branch `server-before-sync` (`d438dea`) is the pre-sync backup. Not an ancestor of `main`. `node_modules` installed in all three packages |
| fs-enrs | user | `main` | `6ab4dc6` | **20 entries** (§3) | 1 stash: `pre-deploy-stash-95b7e7d` (24 files) |
| fs-enrs-dev | user | `main` | `95b7e7d` | `M backend/.env`, `M fs-dev-all.sh`, `?? backend/package-lock.json` | Older copy. **`fs-dev-all.sh` must not be touched** (standing rule) |
| enrs-tools | root | — | not a Git repo | — | Not in scope; leave in place |
| fs-webrtc | — | — | **missing** | — | — |

### Differences

| Item | Status |
|---|---|
| fs-cc | Same commit. Laptop has the CP-1/CP-2 and documentation changes. Ubuntu-FS has its own **untracked** `agent-desktop/package-lock.json` from an earlier install, which is not the CP-1/CP-2 lockfile |
| fs-enrs | Ubuntu-FS is on an older branch. `fix/tenant-unification` (and migration 051 work) is not checked out there |
| fs-webrtc | Missing on Ubuntu-FS |

## 2. Recommended authoritative working directory

| Repo | Authoritative location (after migration) | Reason |
|---|---|---|
| fs-cc | `/opt/freeswitch-ui/fs-cc` on Ubuntu-FS | PM2 apps and the ecosystem file already point here |
| fs-enrs | `/opt/freeswitch-ui/fs-enrs` on Ubuntu-FS | PM2 `fs-enrs-backend` points here, and so does the FreeSWITCH Lua/sound integration |
| fs-webrtc | `/opt/freeswitch-ui/fs-webrtc` (new clone) | Keeps the three repos side by side. It is only the engine source for CP-3 and is not run as a service |

**Until migration completes, the laptop copies remain authoritative.** GitHub is the bridge: work moves only through commits pushed from one side and pulled on the other. No folder copying, because the line endings and `node_modules` differ by platform.

The laptop copies become read-only references after step M-9 below. Archive them later, only with separate approval.

## 3. The 20 FS-ENRS uncommitted entries: safe handling

| Group | Entries | Nature | Handling |
|---|---|---|---|
| Live configuration | `M backend/.env` | Real settings (`SIP_DOMAIN`, `ESL_DOMAIN`, `ESL_HOST`, `INITIAL_ADMIN_NAME` changed; `PIPER_BACKEND_URL` and `PIPER_LUA_URL` added; `PIPER_BACKEND_URL` appears twice) | **Keep in place.** Back it up outside the repo, and never commit it. Check whether `.env` is wrongly tracked; if so, untracking it is a separate approval |
| Old env backups | `backend/.env.bak.20260916`, `backend/.env.bak.esl_fix.20260903_223039` | Contain secrets | Move to a root-only backup folder outside the repo (e.g. `/root/env-backups/`), with approval |
| Lockfile drift | `M backend/package-lock.json` (+46), `M frontend/package-lock.json` (−39), `backend/package-lock.json.bak` | Created by local installs | Save a copy, then let the branch's own lockfiles win at checkout. Re-run `npm ci` |
| Uploads | `backend/uploads/` (1 file, 126 KB) | Runtime data | Copy to the backup folder. Add it to `.gitignore` in a reviewed commit (separate approval) |
| Prompt audio | 13 `*.wav` in the repo root (`welcome_*.wav`, `enter_pin.wav` …) | Probably generated IVR prompts | Check against `/opt/freeswitch/share/freeswitch/sounds/…/enrs`. If they are duplicates, move them to the backup folder. If they are unique, decide whether they belong in the repo |

**Procedure (approval A-4):**
1. Make a full archive first: `tar czf /root/backups/fs-enrs-wt-$(date +%F).tgz` of every changed and untracked path. Also record `git stash list` and `git diff` to files in the same folder.
2. Do **not** use `git stash`, `git reset` or `git clean`. The existing stash `stash@{0}` stays as it is.
3. Check out `fix/tenant-unification` only when the tree holds nothing Git would overwrite. Git refuses the checkout if a tracked file conflicts, which is the safety net.
4. Restore `backend/.env` from the backup if the checkout touched it.

## 4. How each application runs today

| App | PM2 name | Command | cwd | Port | Running now |
|---|---|---|---|---|---|
| FS-CC backend | `fs-backend` | `node server.js` | `fs-cc/backend` | 4000 | **No** |
| FS-CC admin UI | `fs-frontend` | `npm run dev -- --host 0.0.0.0 --port 8000` (Vite dev server) | `fs-cc/frontend` | 8000 | **No** |
| FS-CC Agent Desktop | `fs-agent` | `npm run dev -- --host 0.0.0.0 --port 8080` | `fs-cc/agent-desktop` | 8080 | **No** |
| FS-ENRS backend | `fs-enrs-backend` | `node server.js` | `fs-enrs/backend` | 4100 (`.env`) | **No** |
| FS-ENRS frontend | none | (Vite, `VITE_DEV_PORT=8100`) | `fs-enrs/frontend` | 8100 | No; started by hand when needed |

**PM2 state:**
- `/root/.pm2/dump.pm2` (2026-10-25) lists the four apps as "online". That is how they looked when last saved, not now.
- `/home/user/.pm2/dump.pm2` lists `fs-enrs-backend` too. That would be a **duplicate owner** if both lists were restored.
- No `pm2-root` or `pm2-user` systemd unit exists, so nothing restores the apps after a reboot. That is why none of them is running.
- **Recent logs:** `fs-agent` and `fs-frontend` show only Vite WebSocket-proxy timeouts. `fs-backend` ends inside an SQL statement, so its last error needs reading in full (P-2).

**Services:**
- FreeSWITCH 1.10.12: enabled and active. It listens on 5060/5080 (TCP and UDP), 5066 (WS), 7443 (WSS) and ESL 8021.
- PostgreSQL on 127.0.0.1:5432 and Redis on 6379: enabled and active.
- Piper (uvicorn) on 0.0.0.0:5000.

**Environment variable names** (values not shown):
- **fs-cc `backend/.env`:** `PORT, NODE_ENV, BUSINESS_TIMEZONE, CORS_ORIGIN, DB_*, FS_ESL_*, JWT_SECRET, FS_SIP_DOMAIN`.
- **fs-enrs `backend/.env`:** `NODE_ENV, PORT, DB_*, JWT_*, SIP_DOMAIN, ESL_DOMAIN, ESL_*, INTERNAL_API_KEY, ENS_ORIGINATE_MODE, FS_*_DIR, CORS_ORIGIN, UPLOAD_*, SEED_ADMIN_*, INITIAL_ADMIN_*, PIPER_*`.
  - It has **no `FS_SIP_DOMAIN`**, which the ENRS code reads for the PAI header (`config.sipDomain`). So the PAI header is omitted today.
  - `REDIS_*` is in `.env.example` but missing from `.env`, so the defaults apply.

**Dependencies:** each package has a lockfile and an installed `node_modules`. The agent-desktop install predates CP-2, so it lacks `sip.js`, `typescript`, `vitest` and `jsdom`.

## 5. Node / npm compatibility (CP-1, CP-2)

| Need | Ubuntu-FS today | OK? |
|---|---|---|
| Vite 6.4.5 (`^18 \|\| ^20 \|\| >=22`) | Node 22.22.1 | Yes |
| vitest 5.1.0 | 22.22.1 | Yes |
| jsdom 31.0.0 (`^22.22.2`) | 22.22.1 | **No.** `npm ci` warns (EBADENGINE), and the tests may fail |
| typescript 6.0.3 | 22.22.1 | Yes |
| Lockfile v3 | npm 9.2.0 | Yes. npm 9 reads v3, but may rewrite metadata; CP-1/CP-2 were verified with npm 10 (Node 22.23.4) |

**Node upgrade approach (approval A-5). Recommended: a side-by-side, user-local Node; leave the system package alone.**
- Install Node ≥ 22.22.2 for user `user` in `~/.local/node22` (the same verified tarball approach used in the `Ubuntu` distro for CP-1/CP-2). Put it on `PATH` only for agent-desktop builds and tests.
- `/usr/bin/node` (Ubuntu package 22.22.1) stays untouched, so PM2, FreeSWITCH helper scripts and fs-enrs keep their current runtime.
- **Rollback:** delete the folder and remove the `PATH` line.
- **Alternative, not recommended now:** upgrade the system `nodejs` package or switch to NodeSource. That affects every app at once and needs `sudo apt`.
- **Second alternative:** pin jsdom 26.x (Node 18+) in agent-desktop. That reopens CP-2 and is not proposed.

## 6. SIP-domain review

### Where the domain is used today

| Place | Setting | Current value | Effect |
|---|---|---|---|
| FreeSWITCH `vars.xml` line 61 | `domain=$${local_ip_v4}` | `172.25.187.198` (changes with every Windows restart) | Directory domain; registrations are forced to it |
| `directory/default.xml` | `<domain name="$${domain}">` (25 XML files, one domain) | follows `domain` | All extensions live in one domain |
| `sip_profiles/internal.xml` | `force-register-domain`, `force-subscription-domain`, `force-register-db-domain` = `$${domain}`; `challenge-realm=auto_from` | follows `domain` | Every phone registers into `domain`, whatever it sends |
| `sofia status` | alias `172.25.187.198 → internal` | — | The domain is also an alias of the internal profile |
| `dialplan/default.xml` | `${domain_name}` in `user/…@${domain_name}`, `group`, `hash` | follows `domain` | Extension-to-extension dialling |
| FS-CC `backend/.env` | `FS_SIP_DOMAIN` | `172.21.20.57` (stale) | Builds agent contacts `user/<ext>@<domain>` when an agent is saved |
| **FS-CC database** `agents.contact` | stored strings | 4 of 5 agents: `…user/<ext>@172.21.20.57`; 1: `sofia/default/1` | **Stored when saved, so changing `.env` alone does not fix them** |
| FS-ENRS `backend/.env` | `SIP_DOMAIN` | `172.21.20.57` (stale) | `config.esl.domain`, used to build `user/…@domain` dial strings |
| FS-ENRS code | `FS_SIP_DOMAIN` (not set) | empty | PAI header fallback; `sip_gateways.sip_domain` overrides it per gateway |
| FS-WebRTC | `VITE_SIP_DOMAIN` / `wssUrl` (lab: 192.168.1.133) | — | The SIP URI domain the browser registers with |

### Would a fixed name (for example `pbx.local`) break things? (expected impact, **not yet proven**)

> **Revision 2026-11-07 (review feedback).** The table below is an analysis of the configuration, not evidence.
> A fixed name is **not yet approved**. Two separate things must not be confused:
> - **SIP realm/domain:** the name FreeSWITCH uses inside the directory, digest authentication and `user/…@domain` dial strings.
> - **Network-resolvable SIP/WSS host:** the address or name phones and browsers actually connect to, which must match the TLS certificate.
>
> Before any change, run the read-only checks R-1 to R-6 (§9a) and record the results. The domain change (M-7) remains behind its own approval.

| Area | Impact | Why |
|---|---|---|
| Directory users | **None.** No user file names a domain; they all inherit `$${domain}` | One domain block |
| Registrations | Phones keep working **if** they register to the server's IP: `force-register-domain` rewrites the domain, and the profile must also accept the name as an alias (set `domain` and FreeSWITCH adds it) | Desk phones configured with "domain = old IP" are rewritten anyway |
| Digest auth | **Watch.** `challenge-realm=auto_from` uses the From domain. Phones that send the IP still authenticate, because the realm is what they sent | Test with one phone (V-3) |
| Dial strings in the dialplan | None. `${domain_name}` follows `domain` | — |
| **FS-CC stored contacts** | **Must be rewritten** from `@172.21.20.57` to `@pbx.local`, via a reviewed SQL `UPDATE` on `agents.contact`, or by re-saving each agent in the admin UI | Database change: approval A-8 |
| mod_callcenter | Uses the agent contact strings above | Same fix |
| FS-ENRS | `SIP_DOMAIN=pbx.local`. Dial strings follow. Also set `FS_SIP_DOMAIN` only if PAI is wanted (behaviour change, separate decision) | — |
| WebRTC | The browser URI becomes `sip:<ext>@pbx.local`. WSS still connects to an IP or host. **The certificate in `tls/wss.pem` must match the host name the browser uses for `wss://`**, not the SIP domain. Check its subject (read-only `openssl x509 -noout -subject`). Do not replace `wss.pem` | No conflict, provided the URI domain and the WSS host are configured separately (engine finding E-5) |
| Name resolution | The name doesn't need DNS: `user/…@pbx.local` is resolved internally by FreeSWITCH. Phones still register to the IP | Only add `/etc/hosts` entries if something must connect *to* `pbx.local` |
| Lab server 192.168.1.133 | Not affected. Its own `domain` stays as it is | Separate machine |

## 7. Ports and services required

| Component | Port(s) | Bind | Reached from |
|---|---|---|---|
| FreeSWITCH SIP internal | 5060 TCP/UDP | WSL IP | Windows / LAN via portproxy (signalling only) |
| FreeSWITCH SIP external | 5080 TCP/UDP | WSL IP | gateways |
| FreeSWITCH WS / WSS | 5066 / 7443 | WSL IP | browser softphone (WSS 7443 in lab) |
| FreeSWITCH ESL | 8021 | all | FS-CC and FS-ENRS backends via 127.0.0.1 |
| RTP | 16384–32768 UDP (default) | WSL IP | **Not forwardable by portproxy**: LAN audio tests stay on the lab server |
| PostgreSQL | 5432 | 127.0.0.1 | backends |
| Redis | 6379 | 127.0.0.1 | backends |
| Piper TTS | 5000 | 0.0.0.0 | FS-ENRS, FreeSWITCH Lua |
| FS-CC backend | 4000 | — | UIs, Windows `localhost:4000` |
| FS-CC admin UI | 8000 | 0.0.0.0 | Windows browser |
| Agent Desktop | 8080 | 0.0.0.0 | Windows browser |
| FS-ENRS backend / UI | 4100 / 8100 | — | Windows browser |
| FS-WebRTC | — | — | engine source only (no server in this phase) |

Windows `localhost:<port>` forwarding works automatically for TCP in WSL NAT mode. LAN access needs portproxy (approval A-9).

## 8. RAM on the 8 GB laptop

- **WSL VM limit:** 3.87 GB, shared by both distros. In use: 877 MB, plus 2.7 GB cache; 2.99 GB available.
- **Estimated with everything running:**
  - FreeSWITCH ~150 MB, PostgreSQL ~150 MB, Redis ~10 MB, Piper ~300–500 MB.
  - Three Vite dev servers ~250 MB each.
  - Two Node backends ~120 MB each.
  - Total about **1.8–2.2 GB**.
  - That fits, but `npm ci` or a build at the same time adds 0.5–1 GB.
- **Recommendations:**
  1. Run **one** distro day to day. Stop `Ubuntu` (`wsl --terminate Ubuntu`) when you don't need it (approval A-10).
  2. Start only the Vite servers you are working on, rather than all three.
  3. Optionally raise the `.wslconfig` memory to 4.5–5 GB, leaving Windows about 3 GB. This needs `wsl --shutdown` (approval A-10).
  4. Build or test in one terminal at a time.

## 9. Ordered migration steps, with rollback

Each step needs its approval (§10) before it starts, and each ends with a check. Stop at the first failure.

| # | Step | Check | Rollback |
|---|---|---|---|
| M-0 | **Back up:** `tar` of `/opt/freeswitch/etc/freeswitch`, all `.env` files, `/root/.pm2` and `/home/user/.pm2` into `/root/backups/<date>/` (root-only, mode 700). Also `pg_dump` of `fs_cc` and `fs_enrs` | Archives list correctly; dump sizes are non-zero | Nothing changes |
| M-0b | **Verify the backups can be read:** `tar -tzf` lists every archive; `pg_restore --list` (or `head` of the plain dump) reads each database dump; checksums are recorded in a `MANIFEST.sha256` | All readable; checksums recorded | Nothing changes |
| M-1 | Clean up the stray PM2 daemons. **First confirm each daemon's `PM2_HOME`** from `/proc/<pid>/environ` and from the `God Daemon (<home>)` text in `ps`. Confirm `pm2 jlist` for that home returns an empty list (0 apps). Only then run `PM2_HOME=<that home> pm2 kill`, as that owner. Skip any daemon that manages an app. Dump files are kept | `ps` shows no PM2; ports 4000/8000/8080/4100 unchanged | None needed. The dump files are untouched |
| M-2 | Install the user-local Node ≥ 22.22.2 (§5) | `node -v` in a new shell; `/usr/bin/node` is still 22.22.1 | Delete the folder |
| M-3 | **fs-enrs:** preserve the working tree (§3), then `git fetch` and `git checkout fix/tenant-unification` | `git log -1` = `63977bf`; `.env` unchanged (checksum) | `git checkout main`, then restore the files from the archive |
| M-4 | **fs-enrs:** `npm ci` in backend and frontend. Run the migrations the branch needs (051 …) on `fs_enrs` **only after** reviewing them | Tests pass; the backend starts by hand on 4100 | Restore the `pg_dump`; `git checkout main` |
| M-5 | **fs-cc:** commit CP-1/CP-2 and the docs on the laptop (in a branch) and push. Then on Ubuntu-FS: `git fetch`, check out that branch, run `npm ci` in agent-desktop with the new Node | `npm run build` and `npm test` pass; the lockfile is unchanged | `git checkout main`; `npm ci` again |
| M-6 | **fs-webrtc:** `git clone` into `/opt/freeswitch-ui/fs-webrtc` as `user`, at `23ab1ce` | `git log -1` | Delete the folder |
| M-7a | **Read-only domain checks R-1 to R-6** (§9a), with results recorded in this document | Evidence recorded | Nothing changes |
| M-7b | **Decision checkpoint:** keep the IP-following domain, or adopt a fixed realm, based on M-7a | Owner decision | — |
| M-7c | FreeSWITCH `vars.xml` change and restart (own approval) | V-1 … V-4 | Restore `vars.xml` from M-0, then restart FreeSWITCH |
| M-7d | `.env` changes for fs-cc `FS_SIP_DOMAIN` and fs-enrs `SIP_DOMAIN` (own approval) | V-5, V-6 | Restore the `.env` files from M-0 |
| M-7e | **Agent contacts (own approval):** the transaction in §9b, only for the agents identified there | Row check inside the transaction | The rollback script in §9b |
| M-8 | **PM2:** start the apps from `ecosystem.config.js` under **one owner** (root, as today), remove the duplicate `fs-enrs-backend` in the user dump, `pm2 save`. Boot start-up (`pm2 startup`) is optional | Ports 4000/8000/8080/4100 listen; browser login works | `pm2 delete all`; restore `/root/.pm2/dump.pm2` |
| M-9 | Agree the working rule: edit on Ubuntu-FS (VS Code Remote-WSL), and the laptop copies become read-only | — | — |
| M-10 | Optional: portproxy refresh script for LAN desk phones; `.wslconfig` memory | `netsh interface portproxy show all` | `netsh interface portproxy reset`; restore `.wslconfig` |

**PM2 investigation plan (P-steps, read-only, can run before M-8):**
1. P-1: diff the root dump against `ecosystem.config.js`: names, cwd, env and port.
2. P-2: read the last 100 lines of each `/root/.pm2/logs/*-error.log` and `*-out.log` to find the last real error, especially the truncated SQL in `fs-backend`.
3. P-3: check when they last ran (log timestamps) against the old laptop's move.
4. P-4: decide on one owner (root or `user`). **Recommendation:** `user`, because fs-enrs is owned by `user` and running as root is not needed. That means changing ownership of `/opt/freeswitch-ui/fs-cc` (approval A-7).

**SIP-domain validation (after M-7):**
- **V-1:** `sofia status` shows the new alias; `fs_cli -x 'eval $${domain}'` returns the name.
- **V-2:** `user_exists id <ext> pbx.local` returns true for the lab extensions.
- **V-3:** one desk phone or softphone registers; `show registrations` lists it under the new realm.
- **V-4:** extension-to-extension call through `user/…@${domain_name}`.
- **V-5:** FS-CC: a queue call to an internal agent (stored contact updated) rings. Saving an agent writes `@pbx.local`.
- **V-6:** FS-ENRS: a test ring to an internal extension succeeds.
- **V-7:** after a Windows restart (new WSL IP), V-1 to V-6 still pass with no edits.

## 9a. Read-only domain checks (before any domain decision)

| ID | Check | Command (read-only) | What it proves |
|---|---|---|---|
| R-1 | Directory lookup under the current domain and any candidate name | `fs_cli -x 'user_exists id <ext> <domain>'`; `fs_cli -x 'xml_locate directory domain name <domain>'` | Which names the directory answers to today |
| R-2 | How phones register today | `fs_cli -x 'sofia status profile internal reg'` (realm, contact, user agent; no passwords) once a phone is registered | The domain and realm each phone actually sends |
| R-3 | Every dial string that names a domain | `grep` of the dialplan, Lua scripts, FS-CC and FS-ENRS code and DB tables (`agents.contact`, `sip_gateways.sip_domain`) | The full list of what would need to change |
| R-4 | Certificates | `openssl x509 -noout -subject -ext subjectAltName -in tls/wss.pem` (read only; never replaced) | Which host name the browser must use for WSS |
| R-5 | Phone and softphone configuration | Owner lists each device's configured server and domain | Whether any device depends on the IP as its domain |
| R-6 | FS-ENRS and FS-CC behaviour with a mismatched domain | Code reading of `config.esl.domain` and `config.fs.sipDomain` use sites | Which features break, and how |

## 9b. The four agent records (transaction plan, not yet run)

1. **Identify (read-only):** `SELECT id, name, extension, contact FROM agents WHERE contact LIKE '%@172.21.20.57%' ORDER BY id;`. Record the exact IDs and values in this document. The fifth agent (`sofia/default/1`) is **excluded**.
2. **Back up the rows:** `\copy (SELECT * FROM agents WHERE id IN (<ids>)) TO '/root/backups/<date>/agents_before.csv' CSV HEADER`, plus a note of the matching mod_callcenter agent entries.
3. **Update in one transaction:**
   ```sql
   BEGIN;
   UPDATE agents
      SET contact = replace(contact, '@172.21.20.57', '@<new-domain>')
    WHERE id IN (<ids>) AND contact LIKE '%@172.21.20.57%';
   -- expect exactly 4 rows; otherwise ROLLBACK
   SELECT id, contact FROM agents WHERE id IN (<ids>);
   COMMIT;   -- only if the count and values are correct
   ```
4. **Rollback script, prepared in advance:** one `UPDATE agents SET contact = '<old value>' WHERE id = <id>;` per agent, generated from the backup CSV. Then reload mod_callcenter's view of each agent (FS-CC re-sync, or `callcenter_config agent set contact`) if needed.
5. Order: only after M-7c succeeds, so FreeSWITCH already answers to the new domain.

## 10. Actions requiring your approval

| ID | Action | Changes |
|---|---|---|
| A-1 | `pm2 kill` the two empty PM2 daemons (root and `user`) that inventory checks spawned | processes only |
| A-2 | Create root-only backups (M-0), including `pg_dump` | new files in `/root/backups` |
| A-3 | Choose the SIP domain name (e.g. `pbx.local`) | decision |
| A-4 | Preserve and relocate the 20 fs-enrs entries, and check out `fix/tenant-unification` | repo working tree |
| A-5 | User-local Node ≥ 22.22.2 on Ubuntu-FS | new folder in `~user` |
| A-6 | Commit and push the fs-cc CP-1/CP-2 and docs in a branch | Git, GitHub |
| A-7 | Choose the PM2 owner. If `user`: `chown` `/opt/freeswitch-ui/fs-cc` | file ownership |
| A-8 | Edit `vars.xml`, both `.env` files and the `agents.contact` rows, then restart FreeSWITCH | FreeSWITCH config, database, restart |
| A-9 | Windows portproxy and the refresh script | Windows networking (needs admin) |
| A-10 | `.wslconfig` memory change and `wsl --shutdown` / `--terminate Ubuntu` | WSL |
| A-11 | `npm ci` and migrations for fs-enrs (M-4) | `node_modules`, `fs_enrs` schema |
| A-12 | Clone fs-webrtc into `/opt/freeswitch-ui` | new folder |
| A-13 | Later: archive the laptop copies, and `.gitignore` fixes for `uploads/`, `*.wav`, `.swo` | repos |

## 11. What this preparation did

- **Read-only commands:** `git` (with `--no-optional-locks`), `ss`, `systemctl is-*`, `ps`, `grep`, `dpkg -l`, `fs_cli` show commands, and `SELECT` queries (counts and masked patterns only).
- **Secrets:** only variable names were printed for `.env` files, plus non-secret host, port and domain values.
- **Unintended side effect:** a `pm2 -v` call spawned an empty root PM2 daemon (§0). No app was started.
- **Nothing else changed:** no installs, configuration, database, repositories, or service starts or stops.
- **Files written:** this report, plus two inventory scripts in the session scratchpad (`inv3.sh`, `inv4.sh`).

## 12. Results: M-0, M-0b and M-7a (run 2026-11-07)

Approved scope: M-0, M-0b, M-7a only. M-1 and later steps were **not** started.

### M-0 Backups

**Location:** `/root/backups/20261107-193452/` (directory mode `700`, owner root; every file mode `600`). Total size 3.8 MB.

| File | Format | Size (bytes) | Contents |
|---|---|---|---|
| `freeswitch-etc.tgz` | tar.gz | 153 198 | `/opt/freeswitch/etc/freeswitch` (264 entries, includes `tls/`) |
| `env-files.tgz` (+ `env-files.list`) | tar.gz | 6 551 | 11 `.env*` files under `fs-cc` and `fs-enrs` (not `fs-enrs-dev`) |
| `pm2-data.tgz` | tar.gz | 2 248 110 | `/root/.pm2` and `/home/user/.pm2`: dump files, logs, modules (25 entries; sockets and pid files excluded) |
| `wt-fs-cc.tgz` (+ `.list`, `.status.txt`, `.diff`, `.stash.txt`, `.head.txt`) | tar.gz + text | 21 744 | 2 untracked files |
| `wt-fs-enrs.tgz` (+ same metadata) | tar.gz + text | 897 462 | all 20 working-tree entries (the `.env` changes, `.env` backups, lockfiles, uploads, 13 `.wav`). `git diff` saved; stash list recorded |
| `fs_cc.dump` | `pg_dump -Fc` (custom) | 131 877 | database `fs_cc` |
| `fs_enrs.dump` | `pg_dump -Fc` (custom) | 360 544 | database `fs_enrs` |
| `pg-version.txt`, `MANIFEST.sha256` | text | — | PostgreSQL client version; SHA-256 of every file |

`fs_enrs_dev` was not dumped or touched. No repository command other than read-only `git status`, `diff`, `stash list` and `log` was used.

**Script issue, fixed:** the first attempt (`/root/backups/20261107-193440/`) stopped at the PM2 archive. I had written tar's exclude options after the folder names, so tar tried to archive the PM2 socket files and exited with an error. That folder is **incomplete**. It holds only `freeswitch-etc.tgz` and `env-files.tgz` and must not be used for restore. It was left in place; deleting it is for you to decide.

### M-0b Verification: all passed

| Check | Result |
|---|---|
| `tar -tzf` on each archive | readable: env-files 11, freeswitch-etc 264, pm2-data 25, wt-fs-cc 2, wt-fs-enrs 20 entries |
| `pg_restore --list fs_cc.dump` | 174 TOC entries; 15 table-data entries = 15 live tables |
| `pg_restore --list fs_enrs.dump` | 515 TOC entries; 42 table-data entries = 42 live tables |
| `sha256sum -c MANIFEST.sha256` | OK for all files |

Key checksums: `fs_cc.dump` `61365a58…6cac315`, `fs_enrs.dump` `53479101…f457cf28`, `freeswitch-etc.tgz` `4a252717…0776da`, `wt-fs-enrs.tgz` `508f2d51…3fa2d`. The full list is in `MANIFEST.sha256`.

A restore test (restoring into a scratch database) was **not** done. It needs `createdb` and is outside this approval.

### M-7a Read-only checks

**C** = confirmed by command output. **A** = assumption or not yet proven.

| ID | Finding | Evidence | C/A |
|---|---|---|---|
| R-1 | FreeSWITCH `domain` = `domain_name` = `local_ip_v4` = `172.25.187.198` | `eval $${domain}` | C |
| R-1 | Directory: one domain; users 1000–1019, `brian`, `default`, `example.com`, `skinny-example`, `x` | `directory/default/` listing | C |
| R-1 | `user_exists` for 1000, 1001, 1002, 1004: **true** at `172.25.187.198`, **false** at `172.21.20.57`, false at `pbx.local` | `user_exists id <ext> <domain>` | C |
| R-1 | `domain_exists 172.21.20.57` = false; `pbx.local` = false | `domain_exists` | C |
| R-1 | **Consequence:** the four agents' stored dial strings `user/<ext>@172.21.20.57` cannot reach a user today | follows from the two rows above | C (by lookup). Not tested with a live call |
| R-2 | 0 phones registered on any profile | `sofia status profile internal reg`, `show registrations` | C |
| R-2 | So the domain and realm that real phones send **could not be observed**. Registering a phone was outside this approval | — | A (open) |
| R-2 | mod_callcenter has the same 5 contacts loaded (4 × `@172.21.20.57`, 1 × `sofia/default/1`), all Logged Out | `callcenter_config agent list` | C |
| R-3 | The exact four agent rows: id **1** `{sip_cid_type=pid}user/1000@172.21.20.57`; id **2** `{sip_cid_type=pid,leg_timeout=10}user/1001@…`; id **303** `{sip_cid_type=pid,leg_timeout=10}user/1002@…`; id **3525** `{sip_cid_type=pid}user/1004@…`. Excluded: id **3610** `sofia/default/1` | `SELECT id, contact FROM agents` | C |
| R-3 | In `fs_cc`, `agents.contact` is the **only** text column holding an IP-style SIP value | scan of all text columns | C |
| R-3 | In `fs_enrs`: `sip_gateways` has 0 rows, so there is no per-gateway SIP domain. 3 rows in `recordings` (4 path columns) match the scan pattern; their contents were not inspected | scan | C (count); A (meaning) |
| R-3 | FreeSWITCH config: no hard-coded `172.2x` address. The only `192.168.x` values are in unused sample module configs (sangoma, easyroute, graylog2, acl sample) | grep | C |
| R-3 | Dialplan uses `${domain_name}` throughout (follows `domain`) | grep (earlier) | C |
| R-3 | Lua `ers_conference_bridge.lua` uses only the gateway's `sip_domain` for PAI. No local domain | grep | C |
| R-4 | `tls/wss.pem` and `dtls-srtp.pem`: self-signed, `CN=FreeSWITCH`, **no subjectAltName**, valid 2026-08-22 → 2126 | `openssl x509 -noout` (public fields only) | C |
| R-4 | Consequence: neither the IP nor any host name matches the certificate. Browsers will only accept WSS after a manual exception or a trusted cert. Changing the SIP realm makes no difference to this | follows from above | C (cert); A (browser behaviour not tested) |
| R-5 | Internal profile binds and advertises the WSL IP: SIP 5060, WS 5066, WSS 7443 | `sofia status profile internal` | C |
| R-5 | Profile settings that depend on the domain: `apply-inbound-acl=domains` (ACL built from directory users), `inbound-reg-force-matching-username=true`, `force-register-domain` | `internal.xml` | C |
| R-5 | **How each desk phone or softphone is configured (server, domain, realm)** | needs owner input; nothing is registered | A (open) |
| R-6 | FS-CC: `FS_SIP_DOMAIN` is used **only** to build a contact when an agent is saved (`agentsController.js:39-46`). Existing rows are never rewritten | code reading | C |
| R-6 | FS-ENRS: `SIP_DOMAIN` feeds `config.esl.domain`. **No non-test backend code reads it.** The live setting is `FS_SIP_DOMAIN` (`config.freeswitch.sipDomain`), which is **unset**, so PAI headers are omitted (`eslService.js:1773`, `ersRingService.js:118`, `ersInternalController.js:295`) | grep of non-test code | C (by search); A (dynamic access not ruled out) |

### What this means for the decision at M-7b

1. **Confirmed problem:** the four agents (ids 1, 2, 303, 3525) are unreachable with today's domain. That is true whichever option is chosen: the rows must change either way.
2. **Following the IP (current behaviour)** would need those rows rewritten after **every** Windows restart.
3. **A fixed realm** keeps the rows stable. Still unproven:
   - (a) phones registering with the IP as their domain (R-2/R-5 open);
   - (b) `apply-inbound-acl=domains` behaviour under the new domain;
   - (c) mod_callcenter picking up the changed contacts.

   Each of these needs a lab test with one phone, which needs its own approval.
4. FS-ENRS `SIP_DOMAIN` appears unused. Changing it is low-impact, but not proven.
5. The certificate question is separate from the realm question.

**Nothing was changed:** no FreeSWITCH config, `.env` file, database row, registration, PM2 process, application or repository was modified.

## 13. SIP domain investigation, completed (read-only, 2026-11-07)

**C** = confirmed by command output or file content on Ubuntu-FS. **A** = assumption or general FreeSWITCH behaviour not tested here.

### 13.0 Incident during this investigation: please read

My inventory script accidentally ran `fs_cli -x 'reloadacl'` **once** on Ubuntu-FS. I had tried to remove that line before running the script, but the edit failed and I didn't check it.
- **What it does:** `reloadacl` re-reads `acl.conf.xml` and the directory into FreeSWITCH's in-memory access lists. No file was changed.
- **Expected effect:** the lists were rebuilt from the same, unchanged configuration (A). FreeSWITCH was **not** restarted: uptime was 2 h 1 min, with 0 sessions, at the check.
- **Phones:** no calls or registrations existed, so none was affected (C: 0 registrations, 0 sessions).
- **Log:** I couldn't confirm the event from the log, because grep treats `freeswitch.log` as binary.
- **Prevention:** later scripts were read back before running, and they contain no reload commands.

### 13.1 The access rule

**Files and excerpts (C):**
- `/opt/freeswitch/etc/freeswitch/sip_profiles/internal.xml`:
  - line 128 `<param name="apply-inbound-acl" value="domains"/>`
  - line 134 `<!--<param name="apply-register-acl" value="domains"/>-->` (**disabled**)
  - line 279 `auth-calls = $${internal_auth_calls}`, set to `true` in `vars.xml:414`
  - line 283 `inbound-reg-force-matching-username=true`
  - lines 313/315/317 `force-register-domain`, `force-subscription-domain` and `force-register-db-domain` = `$${domain}`
  - line 368 `challenge-realm=auto_from`
  - line 101 `apply-nat-acl=nat.auto`
  - line 133 `local-network-acl=localnet.auto`
- `/opt/freeswitch/etc/freeswitch/autoload_configs/acl.conf.xml`:
  ```xml
  <list name="domains" default="deny">
    <node type="allow" domain="$${domain}"/>
  </list>
  ```
  A `domain=` node does not allow the domain's name. It **adds the `cidr=` of every user in that directory domain**, as the file's own comment says.
- **Directory (C):** none of the 25 user files under `directory/default/` has a `cidr=` attribute (grep: 0 matches).
- **Live test with the read-only `acl <ip> <list>` API (C):** `domains` returns **false** for 172.25.187.198, 172.25.176.1, 127.0.0.1 and 192.168.1.50.

**When it is evaluated (A, standard mod_sofia behaviour):**
- On each inbound INVITE (and other non-REGISTER requests) to the internal profile.
- If the source IP matches the list, the request is treated as already authenticated, as that user.
- If it doesn't match and `auth-calls=true`, the request is **challenged for a password**. It is not rejected.
- REGISTER is not subject to it, because `apply-register-acl` is disabled.
- The list is built at load or `reloadacl`. `$${domain}` is fixed when the configuration is loaded.

**Effect today and under a domain change:**

| Flow | Today | With a fixed domain | Basis |
|---|---|---|---|
| Internal SIP registration (desk phone, softphone) | Always digest-authenticated. The ACL is not applied to REGISTER | Same: still authenticated by password | C (config), A (mod_sofia logic) |
| Browser WebRTC registration (WSS 7443) | Same profile, same rule: authenticated | Same | C (same profile), A |
| Extension-to-extension call | INVITE from a phone: ACL false, so challenged, then authenticated. Dialplan `default.xml:267-289` bridges `user/${dialed_extension}@${domain_name}` | Same. `${domain_name}` follows the new domain | C (config), A |
| FS-CC queue call to an agent | Originated inside FreeSWITCH (mod_callcenter) using the stored contact `user/<ext>@<domain>`. No ACL is involved. Fails if `<domain>` ≠ directory domain | Works once the four contacts carry the new domain | C (R-1 `user_exists`), A (no live call) |
| FS-ENRS calls to an extension | `dialResolver.js:117-130` dials `user/<ext>` with **no domain**, so FreeSWITCH uses its default domain | Follows the new domain automatically | C (code), A (the "default domain" behaviour of `user/`) |

**Conclusion (C for the configuration, A for runtime):** because no user has a `cidr=` attribute, the `domains` access list grants nothing today. It would grant nothing under a new domain either. A fixed domain would **not** change access or authentication behaviour through this rule.

The authentication factors that *do* depend on the domain:
- `force-register-domain`: stores every registration under `$${domain}`.
- `challenge-realm=auto_from`: the realm is whatever domain the phone puts in its From header.

These two are covered in 13.2.

### 13.2 Five separate values

| Value | Where it is set | Today | Must be resolvable or reachable by | Changes with |
|---|---|---|---|---|
| **SIP server address** (where packets go) | Profile binds `sip-ip=$${local_ip_v4}` (`internal.xml:99`) | `172.25.187.198:5060`, plus `:5066` WS and `:7443` WSS | Windows browsers: via `localhost` forwarding (TCP). LAN phones: via Windows portproxy to the Windows LAN IP. FreeSWITCH: itself | Every WSL restart (NAT mode) |
| **Registration domain / auth realm** | Phone's "domain" setting. FreeSWITCH replies with `challenge-realm=auto_from`, so the realm is the domain in the phone's From header. `force-register-domain` then files the registration under `$${domain}` | Whatever each phone sends | **Does not need DNS** if the phone's server/proxy field holds an IP. A phone uses the domain as its destination only when no outbound proxy is set | Phone configuration only |
| **Browser WSS URL / host** | FS-WebRTC `VITE_SIP_WSS_URL`, defaulting to the page's own host (`config.ts:25`) | Not set on Ubuntu-FS; lab uses 192.168.1.133 | The Windows browser must resolve and reach it, and trust its certificate | FS-WebRTC configuration |
| **TLS certificate** | `tls/wss.pem` | Self-signed, `CN=FreeSWITCH`, **no SAN** (C, R-4) | Browser trust: needs a one-time manual exception (visit `https://<host>:7443`) or a certificate with a matching SAN signed by a trusted CA | Only if replaced. **Must not be overwritten** (standing rule) |
| **FreeSWITCH directory domain** | `vars.xml:61` `domain=$${local_ip_v4}`; `directory/default.xml` `<domain name="$${domain}">` | `172.25.187.198` | FreeSWITCH only: it is a lookup key, never resolved by DNS | Every WSL restart (today) |
| (related) SIP URI domain the browser registers as | FS-WebRTC `VITE_SIP_DOMAIN`, defaulting to the page host (`config.ts:24`) | — | Not resolved; used as identity and realm | FS-WebRTC configuration |

These values are independent: changing the directory domain does **not** change the server address, the WSS URL or the certificate, and the reverse is also true (C, from the configuration above).

### 13.3 What a real test phone must show

No phone is registered (C: 0 registrations), so these tests are **blocked** until one is available:

| Information to read from the phone's own settings screen | Why |
|---|---|
| SIP server / registrar address | Where it sends REGISTER: the IP, a host name, or the old WSL IP |
| SIP domain / "realm" field | It becomes the realm (`auto_from`). It must authenticate whatever value is chosen |
| Authentication user name (and that a password is set; **not** the value) | `inbound-reg-force-matching-username=true` requires it to match the user part |
| Transport: UDP, TCP, TLS or WSS | TLS 5061 is disabled (`internal_ssl_enable=false`). WSS 7443 is for browsers only |
| Outbound proxy, if any | Decides whether the domain must be DNS-resolvable from the phone |

**Blocked tests:**
- **T-1:** the phone registers with domain = server IP, while FreeSWITCH's domain is a fixed name.
- **T-2:** the phone registers with domain = the fixed name, and server/proxy = IP.
- **T-3:** an extension-to-extension call in both directions.
- **T-4:** an FS-CC queue call to an agent whose contact uses the fixed domain.
- **T-5:** an FS-ENRS test call to an extension.
- **T-6:** browser WSS registration with a certificate exception.
- **T-7:** everything again after a Windows restart (new WSL IP).

### 13.4 Option A vs Option B (no option selected)

| | **A: dynamic WSL IP (current)** | **B: stable host name as the SIP domain** |
|---|---|---|
| FreeSWITCH config | No change | `vars.xml:61` `domain=<name>`; restart required |
| After a Windows restart | The domain changes. The four FS-CC agent contacts (ids 1, 2, 303, 3525) must be rewritten **every time**, and so must FS-CC `FS_SIP_DOMAIN` | The domain is constant. Contacts are rewritten **once** |
| Agent contact maintenance | A transaction like §9b, repeated per restart, plus mod_callcenter re-sync. Error-prone | One-time §9b transaction |
| FS-ENRS | Unaffected (`user/<ext>`, default domain) | Unaffected |
| Phones | Must use the current IP as the domain, or rely on `force-register-domain`. Untested | Phones can use the name as domain and the IP as server. Untested (T-1, T-2) |
| DNS / hosts | None | **None needed** if phones and browsers point at an IP or `localhost` for the *server*. Needed only if any device uses the name to *connect*: then an entry in `C:\Windows\System32\drivers\etc\hosts` on Windows, phone DNS or the phone's outbound proxy, and `/etc/hosts` in WSL |
| Certificate (WSS) | Unchanged; self-signed, needs a browser exception | Unchanged; independent of the domain |
| ACL `domains` | Grants nothing (no `cidr=`) | Grants nothing; no change |
| Directory lookups | Work for the current IP only | Work for the name only. The IP would no longer be a directory domain, but `force-register-domain` covers REGISTER (A) |
| Authentication | Realm = phone's From domain | Same mechanism |
| Rollback | — | Restore `vars.xml` from the M-0 backup, then restart |

### 13.5 FS-ENRS, reconfirmed (C, code on Ubuntu-FS `fs-enrs` @ `6ab4dc6`)

- **`SIP_DOMAIN`:** read once into `config.esl.domain` (`backend/src/config/index.js:38`).
  - A search of all non-test backend code for `esl.domain`, `config.esl.domain` and `SIP_DOMAIN` finds **no reader**. The `config.esl.*` uses are `host`, `port`, `password` and `reconnectMs` only.
  - `dialResolver.js:36` marks `opts.domain` as "DEPRECATED, ignored", and builds `user/<ext>` (lines 117–130).
  - So changing `SIP_DOMAIN` has **no effect on calls** (C by search; dynamic property access not ruled out: A).
- **`FS_SIP_DOMAIN`:** read into `config.freeswitch.sipDomain` (`index.js:64`). It is **not set** in `backend/.env` (C). It is used for the caller-ID P-Asserted-Identity header:
  - ENS originate: `eslService.js:1773-1787`. `sip_h_P-Asserted-Identity=<sip:<cli>@<domain>>` is only added when a domain exists.
  - ERS ring: `ersRingService.js:118`, `146`.
  - ERS conference bridge: via `/ers/lookup`, `ersInternalController.js:295`, into `ers_conference_bridge.lua:206`.
  - Priority: gateway `sip_gateways.sip_domain` (0 rows today), then `FS_SIP_DOMAIN`, then none.
- **Would a change affect existing ENS/ERS calls?**
  - Leaving `FS_SIP_DOMAIN` unset keeps today's behaviour: no PAI header (C).
  - Setting it would **add** a PAI header to gateway calls. That changes caller-ID behaviour toward carriers and Avaya, and is a separate decision (A).
  - `SIP_DOMAIN`: no effect (C by search).

### 13.6 Unresolved questions

1. Phone settings and behaviour under each option (T-1 to T-7): needs a physical phone or softphone.
2. Whether mod_callcenter picks up the changed contacts from the FS-CC sync, or needs an `agent set contact`.
3. Whether any non-default phone sends a domain that FreeSWITCH can't map. Only matters under B, if `force-register-domain` doesn't cover it.
4. The meaning of the 3 `fs_enrs.recordings` path rows that match `172.2x`/`user/` (§12 R-3). Probably file paths; not inspected.
5. Browser certificate handling for WSS: a trust decision, separate from the domain.

### 13.7 Provisional recommendation (NOT a decision)

**Provisionally prefer Option B:** a stable SIP domain name, with phones and browsers still connecting by IP or `localhost`, so no DNS is required.

The assumptions behind it:
- (a) The access rule is inert because no user has `cidr=`, as confirmed.
- (b) `force-register-domain` and `auto_from` let phones that send the IP as their domain still register (to prove with T-1).
- (c) FS-ENRS is unaffected, as confirmed by code.
- (d) The four contacts need rewriting once under B, against once per restart under A.

**If T-1 fails,** the alternative is Option A, with an automated contact-refresh step after each restart. That needs its own design.

Nothing here should be implemented until T-1 to T-4 have passed on a test phone and you approve M-7b.

**Changed by this task:** this section of the report only. There was one unintended `reloadacl` (13.0). No configuration, `.env`, database, registration, PM2, application or repository change was made.

### 13.8 Stable-domain registration validation (read-only, 2026-11-07)

Before running, the check script was scanned for `reload|restart|rescan|flush|kill|unregister|set contact`. The only matches were a comment and a grep pattern. Commands used: `sofia status`, `sofia status profile internal`, `sofia xmlstatus profile internal`, `acl`, `show registrations`, `show api`, `callcenter_config agent list`, plus `grep` of the configuration and the log.

**C** = confirmed on Ubuntu-FS. **A** = documented or source-level mod_sofia behaviour that was **not** observed here, because no phone was registered.

#### 13.8.1 How registration and authentication work here

| Question | Evidence | Answer | C/A |
|---|---|---|---|
| How the profile selects its domain | `internal.xml:20-24`: the whole `<domains>` block is **commented out**. `force-register-domain`, `force-register-db-domain` and `force-subscription-domain` = `$${domain}` (lines 313–317) | The profile has no parsed domains. All registrations are forced into `$${domain}` | C (config) |
| Where the profile alias comes from | `sofia status` shows `172.25.187.198 alias internal ALIASED` | The current domain is an alias of the internal profile even though `<domains>` is disabled. Probably created from `force-register-domain` or the profile's own IP; source not checked | C (alias exists); A (cause) |
| How REGISTER is matched to a user | `inbound-reg-force-matching-username=true` (283); `force-register-domain` | The user part of To/From must match the authentication user name. The **directory lookup uses the forced domain**, not the domain the phone sent (FreeSWITCH documentation: "all inbound registrations will look in this domain for the users") | C (config); A (lookup behaviour) |
| How the directory domain is chosen | `vars.xml:61` `domain=$${local_ip_v4}`; `directory/default.xml` `<domain name="$${domain}">` | A single directory domain, equal to `$${domain}` | C |
| How `auto_from` sets the realm | `sofia xmlstatus` → `<challenge-realm>auto_from` | The `WWW-Authenticate` realm is the host in the phone's From header, whatever the phone sent | C (setting); A (behaviour) |
| Must the user name and realm match the directory domain? | 21 user files use `name="password" value="$${default_password}"`, including agent extensions 1000–1004. 1 file in `directory/` contains `a1-hash` (which file was not checked) | With a **plain password**, FreeSWITCH computes the digest using the realm the phone sent, so the realm does **not** have to equal the directory domain. With an `a1-hash` user the realm *is* fixed in the hash, so a realm change would break that one user | C (param counts); A (digest logic) |
| Can a phone that registers with the IP as its domain resolve a user under a different fixed domain? | follows from the rows above | **Expected yes:** `force-register-domain` redirects the lookup, and the plain-password digest accepts the IP realm. **Not demonstrated.** This is test T-1 | A |

#### 13.8.2 Scenarios (all expected behaviour; none observed)

| | REGISTER sent | Challenge | Directory lookup | Expected outcome | Main uncertainty |
|---|---|---|---|---|---|
| **A. Phone → WSL IP, domain = WSL IP**, with FreeSWITCH domain set to a fixed name | `REGISTER sip:<ip>`, From/To `<ext>@<ip>` | `401`, realm=`<ip>` (`auto_from`) | Forced into the fixed domain, finding `<ext>` with a plain password | `200 OK`. Stored under the fixed domain (`force-register-db-domain`), so `user/<ext>@<fixed>` and `sofia_contact` find it | Whether `force-register-domain` also covers the auth lookup in 1.10.12 (A). T-1 decides |
| **B. Phone → WSL IP, domain = fixed name** | `REGISTER sip:<fixed>` sent to the IP (server/proxy field = IP), From/To `<ext>@<fixed>` | `401`, realm=`<fixed>` | Fixed domain, which matches directly | `200 OK`. This is the configuration FreeSWITCH's own `directory/default.xml` notice recommends ("set the default domain to the hostname … use the domain name in the client") | The phone must allow server address ≠ domain (outbound-proxy or registrar field); some phones try DNS on the domain. T-2 |
| **C. Browser → WSS `wss://<host>:7443`, URI `sip:<ext>@<fixed>`** | Over WSS, From/To `<ext>@<fixed>` | `401`, realm=`<fixed>` | Fixed domain | `200 OK`, if the browser accepts the TLS certificate first | Certificate trust: `CN=FreeSWITCH`, no SAN (§12 R-4). The WSS host must be one the browser can reach (`localhost` via WSL forwarding, or the IP). FS-WebRTC sets `VITE_SIP_DOMAIN` and `VITE_SIP_WSS_URL` separately (`config.ts:24-25`). T-6 |

Today, with no change, scenario A works with domain = IP (the current design), and B and C would fail the lookup, because `domain_exists pbx.local` = false (C, §12).

#### 13.8.3 Read-only verification commands (none changes runtime state)

| Purpose | Command |
|---|---|
| Active profile settings | `sofia status profile internal`; `sofia xmlstatus profile internal` |
| Profile aliases and domains | `sofia status` |
| Current registrations | `show registrations`; `sofia status profile internal reg`; `sofia_count_reg <ext>@<domain>`; `sofia_contact */<ext>@<domain>` |
| Directory lookup | `user_exists id <ext> <domain>`; `domain_exists <domain>`; `user_data <ext>@<domain> var <name>` (**never** `param password`; avoid `xml_locate directory`, which prints secrets) |
| Runtime ACL state | `acl <ip> <list>` (a membership test only; it cannot list a list's contents) |
| mod_callcenter contacts | `callcenter_config agent list`; `callcenter_config agent get status <name>` |
| Live trace for T-1 to T-6 (read-only, but verbose) | `sofia global siptrace on` changes logging, so it is **not** read-only; it needs approval. Prefer a packet capture on the phone side or `sngrep`, if installed (not checked) |

**Forbidden here:** `reloadacl`, `reloadxml`, `sofia profile … restart|rescan|killgw|flush_inbound_reg`, `callcenter_config agent set …`, `unregister`.

#### 13.8.4 The accidental `reloadacl`: review

- **What happened (C):** my script `sip1.sh` ran `fs_cli -x 'reloadacl'` once on 2026-11-07 (about 20:0x local time), output discarded. I had tried to remove the line before running the script, but the edit failed and I didn't check.
- **Files (C):** `acl.conf.xml` and `directory/` were not edited. No write commands were run against them. The M-0 backup (`freeswitch-etc.tgz`, SHA-256 `4a252717…0776da`) can be compared to prove this byte for byte. That comparison was not run in this task.
- **Log evidence (C):** `freeswitch.log` (37.5 MB) contains `reloadacl` only as `Adding API Function 'reloadacl'` at each module load (the latest 2026-11-07 18:07:47). There is **no line recording the reload itself**. At this log level FreeSWITCH evidently does not log ACL reloads, so the log can neither confirm nor rule out the event.
- **What runtime output does show (C):**
  - `acl` membership tests return the same results before (13.1) and after: `domains`=false for 172.25.187.198, 172.25.176.1 and 127.0.0.1; `localnet.auto` true for the WSL addresses.
  - FreeSWITCH uptime was continuous, with no restart.
  - 0 sessions and 0 registrations.
- **What cannot be proven:**
  - The full contents of every in-memory ACL list. The `acl` API only answers yes/no for a given IP.
  - Whether automatically generated lists (`localnet.auto`, `nat.auto`, `rfc1918.auto`) were rebuilt with the same values. They derive from the same network interfaces, so this is likely (A).
  - **I am not claiming the runtime state is unchanged.** It is only consistent with that in every test that could be run.

#### 13.8.5 Recommendation (provisional)

- **Is Option B technically feasible?** **Yes, by configuration analysis.** FreeSWITCH's own directory notice describes it as the supported way to register by name. `force-register-domain` and plain-password users mean phones that still send the IP as their domain *should* register. Feasibility is **not proven** until T-1 passes.
- **Can a fixed internal domain coexist with IP-based connectivity?** Expected **yes**. The domain is a lookup key and realm, and the connection address is separate (13.2). Scenario B is the clean form; scenario A relies on `force-register-domain` (T-1).
- **Phone test required before implementation:** run it in the lab or on a lab-only extension (7990001/7990002), with no change to Ubuntu-FS. Ubuntu-FS has no phone, and changing its domain to test would itself be the implementation. Two alternatives:
  - **Lab option:** on lab FreeSWITCH 192.168.1.133, confirm its own `domain`, `force-register-domain` and `challenge-realm` match Ubuntu-FS's. Then register one softphone twice: with the domain set to the server IP (T-1), and to a name with the server/proxy set to the IP (T-2). This only works if the lab already has a fixed domain, or if you approve a temporary lab change.
  - **Ubuntu-FS option, needs approval:** approve M-7c with the rollback ready, then run T-1 to T-7 immediately, reverting from the M-0 backup if T-1 or T-2 fails.
  - **Capture for each test:** the phone's server, domain, user and transport settings; `show registrations` (realm, contact); `sofia_contact */<ext>@<domain>`; a test call; no passwords.
- **Remaining requirements:**
  - **Certificate:** a browser exception or a trusted certificate for the WSS host. Independent of the domain. `wss.pem` is not to be replaced.
  - **WSS:** the host must be reachable from Windows (`localhost:7443` via WSL forwarding is expected; untested).
  - **DNS:** none, as long as every device's server/proxy field holds an IP or `localhost`.
  - **Authentication:** check which file holds `a1-hash`. If it's an agent extension, that user needs a new hash.
- **Dependencies, in order:**
  1. T-1/T-2 result.
  2. M-7b decision.
  3. M-7c (`vars.xml` and FreeSWITCH restart).
  4. M-7d (`FS_SIP_DOMAIN`).
  5. M-7e (the four-agent transaction, §9b).
  6. mod_callcenter contact refresh.
  7. Optional: FS-ENRS `FS_SIP_DOMAIN`, if a PAI header is wanted (separate decision).
- **Risks:**
  - (1) `force-register-domain` behaviour differs from the documentation, so IP-domain phones fail. Mitigation: T-1 before rollout.
  - (2) A phone resolves the domain name by DNS. Mitigation: configure server or outbound proxy as the IP.
  - (3) An `a1-hash` user breaks.
  - (4) mod_callcenter keeps the old contacts until re-synced.
  - (5) The restart drops any live calls. None exist today.
  - (6) The ACL runtime state after the accidental reload is not fully provable. A planned FreeSWITCH restart in M-7c would rebuild all lists from the configuration anyway.

**Changed by this task:** this subsection only. No configuration, `.env`, database, contact, reload, restart, PM2, package or Git change was made.

### 13.9 Hash user, test environment and Option B test plan (read-only, 2026-11-08)

The check script was scanned for `reload|restart|rescan|flush|kill|unregister|set contact|UPDATE|DELETE|INSERT` before running: no matches. It printed only file names, user IDs and parameter **names**.

#### 13.9.1 The "precomputed-hash" user: resolved

| Item | Finding | C/A |
|---|---|---|
| File | `/opt/freeswitch/etc/freeswitch/directory/default/brian.xml` (the only file under `directory/` containing `a1-hash`) | C |
| User / domain | `<user id="brian">`, included through `directory/default.xml:40` (`default/*.xml`) into the single domain `$${domain}`. `user_exists id brian 172.25.187.198` = true | C |
| The hash | Line 54 is **commented out**: `<!--<param name="a1-hash" value="<redacted>"/>-->`. It is not active. The user authenticates with an ordinary `password` parameter | C |
| What the file is | The FreeSWITCH stock sample user. Its other parameters (`realm`, `from-domain`, `proxy`, `register-proxy`, `register-transport`, `ping` …) are the sample gateway-in-user block | C (parameter names); A ("stock sample") |
| References | **None found:** no match for `brian` in the dialplan, SIP profiles, autoload configs or Lua scripts; in any text column of `fs_cc` or `fs_enrs`; or in FS-CC or FS-ENRS backend code. The only gateway is the sample `external::example.com` (NOREG), from `sip_profiles/external/example.xml` | C |
| Realm dependence | An `a1-hash` *would* be realm-dependent, but this one is disabled | C |
| **Impact of a domain change** | **None.** No active precomputed hash exists in the directory, so §13.8's risk (3) is closed | C |

#### 13.9.2 Lab server 192.168.1.133: not inspected

**Access is not authorised for this kind of check.**
- The standing rules forbid SSH. Lab use has so far meant running the browser softphone against it, not reading its configuration.
- No credentials or authorised channel for reading its `vars.xml`, profiles or directory exist in this session.
- So **no comparison was made**, and the lab **cannot be assumed equivalent** to Ubuntu-FS.

To use it, you would need to read these yourself, or authorise a read-only method:

| Setting to compare | Ubuntu-FS value (C) | Lab value |
|---|---|---|
| Version | 1.10.12-release `a88d069` | unknown |
| `vars.xml` `domain` | `$${local_ip_v4}` | unknown (FS-WebRTC lab config uses `VITE_SIP_DOMAIN=192.168.1.133`, which suggests the IP: A) |
| `internal.xml` `force-register-domain` / `-db-domain` / `-subscription-domain` | `$${domain}` | unknown |
| `challenge-realm` | `auto_from` | unknown |
| `apply-inbound-acl` / `apply-register-acl` | `domains` / disabled | unknown |
| `auth-calls`, `inbound-reg-force-matching-username` | true / true | unknown |
| `<domains>` block | all commented | unknown |
| WS / WSS bindings | `:5066` / `:7443` | 7443 used by FS-WebRTC (C from that project) |
| Directory users | 1000–1019 + `brian`, plain passwords, no `cidr` | includes lab users 7990001/7990002 (C from earlier work); the rest unknown |
| Dialplan Local_Extension | `user/${dialed_extension}@${domain_name}` | unknown |

**Recommended isolated alternative (no change to the lab or Ubuntu-FS):**
- A **throwaway FreeSWITCH test instance** in the separate `Ubuntu` WSL distro, or on another machine.
- Build it from a copy of the Ubuntu-FS configuration (from the M-0 `freeswitch-etc.tgz`), with `domain` set to the candidate name.
- **Port conflict:** both distros share one VM IP and its ports (§1 of the assessment), so it can't use 5060/5066/7443 while Ubuntu-FS FreeSWITCH is running. It would need its own ports, for example 15060/15066/17443 (an edit to its copy only).
- **This needs package installation** in `Ubuntu` (FreeSWITCH 1.10.12), which is forbidden in this task, so it needs its own approval (B-3).
- **The other option:** run T-1 to T-7 directly on Ubuntu-FS straight after an approved, reversible M-7c.
- **Recommendation:** the Ubuntu-FS route, because there are no live users, M-0 backups exist, and rollback is a single file restore plus a restart.

#### 13.9.3 Test cases

**Common values:**
- **Candidate domain:** `pbx.local` (§13.9.4). **SIP server:** the current WSL IP (today `172.25.187.198`), reached through `localhost` or portproxy as noted.
- **Test extensions:** 1000, 1001, 1002, 1004 (the four agents). Passwords are entered by you on the device, **never recorded**.
- **Softphone:** any SIP client on Windows that has separate *Domain* and *Proxy/Server* fields, for example MicroSIP, Zoiper or Linphone (to be confirmed by you).
- **Evidence per test:** a screenshot of the device's account settings with the password hidden; `show registrations`; `sofia status profile internal reg`; `sofia_contact */<ext>@pbx.local`; the call result. No `siptrace` unless separately approved.

**Where each test can run:** every test needs FreeSWITCH with `domain=pbx.local`. That means **Ubuntu-FS after M-7c**, or the isolated instance (B-3). None can run on the lab without inspecting and possibly changing it.

| Test | Preconditions | Device configuration | Expected REGISTER / auth | Expected state | Expected call result | Pass if | Fail if | Rollback |
|---|---|---|---|---|---|---|---|---|
| **T-1** IP as domain | `domain=pbx.local` active; 0 registrations | Server/registrar = `172.25.187.198:5060` UDP; Domain = `172.25.187.198`; User = auth user = `1000` | `REGISTER sip:172.25.187.198`, then `401` realm=`172.25.187.198` (`auto_from`), then authenticated REGISTER, then `200 OK` | Listed under realm or domain `pbx.local` (forced); `sofia_contact */1000@pbx.local` returns a contact | n/a | `200 OK`, listed, and `sofia_contact` resolves | `403`, repeated `401`, or `sofia_contact` gives `error/user_not_registered` | Delete the account on the device. If B is abandoned: restore `vars.xml` (M-0), then restart |
| **T-2** stable domain | as T-1 | Server or outbound proxy = `172.25.187.198:5060`; Domain = `pbx.local`; User = `1001` | `REGISTER sip:pbx.local` sent to the IP, then `401` realm=`pbx.local`, then `200 OK` | Listed under `pbx.local` | n/a | `200 OK` with **no** DNS lookup failure on the device | The device tries to resolve `pbx.local` and fails, or auth fails | as T-1 |
| **T-3** four agents | T-1 or T-2 passed | Register 1000, 1001, 1002 and 1004 in turn, same method as whichever passed | as above | All four listed | n/a | 4/4 registered | Any rejected | as T-1 |
| **T-4** ext-to-ext | two registered (1000, 1001) | — | INVITE challenged (`auth-calls=true`), then authenticated | — | 1000 dials 1001: rings, answered, two-way audio (same PC: RTP stays inside WSL NAT) | Ring, answer, audio, clean hang-up | No ring, `USER_NOT_REGISTERED`, one-way audio | none needed |
| **T-5** FS-CC queue | M-7d (`FS_SIP_DOMAIN=pbx.local`) and M-7e (four contacts) done; FS-CC backend running (needs M-8 or a manual start, its own approval); agent 1000 Available | — | — | `callcenter_config agent list` shows `user/1000@pbx.local` | Call into the queue: agent 1000 rings; answer; CDR written | Rings and is answered; contact correct | Old contact still loaded; no ring | Restore the four rows (§9b rollback), restore `.env` |
| **T-6** browser WSS | T-1 or T-2 passed; FS-WebRTC dev build pointed at `VITE_SIP_DOMAIN=pbx.local`, `VITE_SIP_WSS_URL=wss://localhost:7443` (or the IP); certificate exception accepted once at `https://localhost:7443` | Extension 1002 (or a lab-only user) | WSS connect, REGISTER, `401` realm=`pbx.local`, `200 OK` | Listed with `transport=wss` | Browser ⇄ softphone call: audio both ways | Registered and audio | TLS refused (certificate), `401` loop, no audio (DTLS/ICE) | Close the tab; no server change |
| **T-7** reconnect / IP change | T-1 to T-4 passed; record the current WSL IP | Device server = **new** IP after restart (or `localhost`) | as T-1/T-2 | Re-registered under `pbx.local` | T-4 call repeated | `eval $${domain}` still `pbx.local`; `user_exists id 1000 pbx.local` true; calls work **with no config or database edit** | Anything needs an edit after the restart | Same as T-1 |

**Reboot effect (T-7, needs approval):** `wsl --shutdown` (or a Windows restart) stops **both** distros and all services, and changes the WSL IP. Desk phones would need their server address updated, or would use portproxy. That is a limit of WSL NAT mode, not of Option B.

#### 13.9.4 Domain proposal (candidate only, not approved)

| Item | Proposal / finding |
|---|---|
| Internal SIP domain | Candidate `pbx.local`. The evidence doesn't favour any particular name; it only needs to be stable, not an IP, and not a real public DNS name. `.local` is the mDNS suffix: if a phone does try to resolve it (T-2 fail case), mDNS behaviour may confuse matters. **An alternative such as `fs.internal` avoids that.** This is your choice |
| DNS needed? | **No**, as long as every device's server/proxy field holds an IP or `localhost` (T-2 proves this per device) |
| SIP connection address | Stays the current WSL IP (changes per restart), or `localhost` from Windows |
| Browser WSS | `wss://localhost:7443` from the Windows browser (expected via WSL TCP forwarding; untested). Certificate: `CN=FreeSWITCH`, no SAN, so a one-time browser exception is needed. **`wss.pem` is not replaced.** A trusted certificate would be a separate decision |
| Hash user | `brian`: no active `a1-hash`, so no impact (13.9.1) |
| Four FS-CC contacts | ids 1, 2, 303, 3525: `@172.21.20.57` becomes `@pbx.local` **once**, through the §9b transaction (M-7e). id 3610 excluded |
| FS-ENRS | `SIP_DOMAIN`: no runtime reader, so changing it is optional and cosmetic. Internal dialling uses `user/<ext>`, which follows the FreeSWITCH default domain automatically. `FS_SIP_DOMAIN` (PAI): **leave unset**, which keeps today's no-PAI behaviour. Setting it is a separate caller-ID decision |

#### 13.9.5 Readiness

- **Is Option B ready for approval?** **Ready for a test approval, not for a permanent rollout.**
  - All read-only preconditions are now closed: the access rule is inert, the hash user is not a risk, FS-ENRS is unaffected, and the four contacts are identified.
  - The deciding evidence (T-1, T-2) can only come from a registration against a FreeSWITCH that already uses the new domain.
- **Remaining blockers:**
  1. No test softphone identified yet. You need to name one.
  2. The lab server is not comparable without an authorised read.
  3. T-5 needs the FS-CC backend running (PM2 is not yet sorted out).
  4. T-6 needs the certificate exception and an FS-WebRTC build.
- **Recommended test environment:** Ubuntu-FS itself, as a reversible trial: M-7c, then T-1 to T-4, then either keep it or roll back from M-0. T-5 and T-6 follow when their dependencies are approved.

**Approvals needed before implementation:**

| ID | Approval |
|---|---|
| B-1 | Domain name (`pbx.local` or an alternative such as `fs.internal`) |
| B-2 | Softphone choice; you configure it yourself |
| B-3 | *(Only if you prefer isolation)* install FreeSWITCH in the `Ubuntu` distro on alternative ports |
| B-4 | M-7c trial on Ubuntu-FS: edit `vars.xml:61` (backup already exists), **restart FreeSWITCH**, run T-1 to T-4, with auto-rollback if T-1 and T-2 both fail |
| B-5 | M-7d: fs-cc `FS_SIP_DOMAIN` in `.env` |
| B-6 | M-7e: the four-row transaction (§9b) and the mod_callcenter contact refresh |
| B-7 | Starting the FS-CC backend for T-5 (manual start or M-8 PM2 decision) |
| B-8 | T-6: FS-WebRTC local build, plus accepting the browser certificate exception |
| B-9 | T-7: `wsl --shutdown` or a Windows restart |
| B-10 | Optional: `sofia global siptrace on` during the tests (logging change) |

**Changed by this task:** this subsection only. No configuration, `.env`, database, contact, reload, restart, PM2, package, Git, phone or lab change was made. The lab server was not accessed.
