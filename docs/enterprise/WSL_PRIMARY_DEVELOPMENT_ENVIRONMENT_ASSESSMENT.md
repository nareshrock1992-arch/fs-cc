# WSL Primary Development Environment Assessment

**Date:** 2026-11-07. **Laptop:** `DESKTOP-K0KH8PB`, Windows 10 Pro 19045, 7.9 GB RAM, 4 logical CPUs, LAN IP 192.168.1.123.

**Method:** read-only commands run inside each distro. Secrets were not printed: from `.env` files only variable *names* and IP-address *patterns* were read.

## Recommendation (summary)

**Primary distro: `Ubuntu-FS`**, the environment restored from the old laptop.

- Its FreeSWITCH, PostgreSQL, Redis and Piper stack is installed, running and enabled, and it holds the project databases.
- The changing-IP problem is a configuration issue: the old laptop's WSL IP is written into two `.env` values. It is not a defect in the distro, so there is no technical reason to rebuild in the new `Ubuntu`.
- `Ubuntu` should be kept only as a disposable build sandbox, or retired later.

---

## Phase A — Inventory

### A.1 Side-by-side

| Item | `Ubuntu` (new, default) | `Ubuntu-FS` (restored) |
|---|---|---|
| Ubuntu / WSL | 26.04.1 LTS, WSL 2, kernel 6.18.54.1 | 26.04.1 LTS, WSL 2, kernel 6.18.54.1 |
| Default user / home | `naresh` / `/home/naresh` | `user` / `/home/user` |
| systemd | yes | yes |
| Node / npm | **none system-wide.** Only the Windows npm 11.20.0 is visible through PATH. Node v22.23.4 is installed user-locally at `~/cp1-tools` (CP-1) | Node **v22.22.1**, npm **9.2.0** (`/usr/bin`); PM2 7.0.4 (`/usr/local/bin`) |
| FreeSWITCH | not installed | **1.10.12** at `/opt/freeswitch`; systemd unit `freeswitch` **active, enabled** (`-ncwait -nonat`, runs as root); config `/opt/freeswitch/etc/freeswitch`; sounds `en`, `enrs`, `music` |
| PostgreSQL | not installed | **18.6**, cluster `18/main` port 5432 **online, enabled**, listens on 127.0.0.1. Databases: `fs_cc` 11 MB, `fs_enrs` 13 MB, `fs_enrs_dev` 11 MB |
| Redis | not installed | **8.0.5**, **active, enabled**, listens on 127.0.0.1 and ::1 port 6379 |
| Docker | not installed | not installed |
| Other services | — | Piper TTS (uvicorn) on 0.0.0.0:5000; sshd on port 22; `ffmpeg` and `sox` installed |
| Repositories | none (only the throwaway copies `~/cp1-fscc` and `~/cp2-fscc`) | see A.2 |
| Disk (`/`) | 954 GB free, 2.0 GB used | 947 GB free, 9.0 GB used |
| Memory seen | 3.8 GiB total (the shared WSL VM) | the same 3.8 GiB, because both distros share one VM |

### A.2 Repositories in `Ubuntu-FS`

All are root-owned under `/opt/freeswitch-ui`. Git needs `safe.directory` to read them; I used it only on the command line, without saving it.

| Path | Branch / HEAD | Uncommitted entries | Compared with the laptop repository |
|---|---|---|---|
| `/opt/freeswitch-ui/fs-cc` | `main` @ `f560dd7` | 2 | Same HEAD as `Documents\fs-cc` |
| `/opt/freeswitch-ui/fs-enrs` | `main` @ `6ab4dc6` (2026-10-10) | 20 | **Older.** The laptop repository is on `fix/tenant-unification` @ `63977bf` |
| `/opt/freeswitch-ui/fs-enrs-dev` | `main` @ `95b7e7d` (2026-09-03) | 3 | Older copy |
| `/opt/fs-cp` | (not inspected as Git) | — | Old monorepo; **not authoritative** |
| `/opt/freeswitch-ui/enrs-tools` | Piper TTS virtual environment | — | — |

**PM2:**
- A **root** PM2 daemon is running, and its saved process list contains `fs-backend`, `fs-frontend`, `fs-agent` and `fs-enrs-backend`.
- None of these apps is listening on a port at the moment.
- Whether they are stopped or errored is **UNKNOWN**. I didn't run `pm2 ls` as root, because that talks to the daemon.

### A.3 Ports

**Both distros run inside the same WSL 2 VM, so they share one network.** The same listening ports and the same IP (`172.25.187.198`) appear inside both.

| Port | Owner (`Ubuntu-FS`) | Bound to |
|---|---|---|
| 5060/5080 TCP+UDP, 5066 (WS), 7443 (WSS) | FreeSWITCH SIP | `172.25.187.198` (current WSL IP) and `::1` |
| 8021 | FreeSWITCH ESL | all interfaces |
| 5432 | PostgreSQL | 127.0.0.1 |
| 6379 | Redis | 127.0.0.1, ::1 |
| 5000 | Piper TTS | 0.0.0.0 |
| 22 | sshd | all interfaces |

**Conflicts:**
- None today.
- Anything started in `Ubuntu` on these ports would collide with `Ubuntu-FS`.
- FS-CC's usual ports (backend 4000, agent desktop 8080) are free.

### A.4 Network and the changing IP

**What Windows has:**
- `.wslconfig` contains `networkingMode=mirrored`.
- On Windows 10 19045, WSL rejects that setting ("Mirrored networking mode is not supported") and **falls back to NAT**. Mirrored mode needs Windows 11 22H2 or later.
- In NAT mode the VM gets a new `172.x` address after a Windows restart. Today it is `eth0 172.25.187.198/20`, with the Windows-side gateway `vEthernet (WSL)` at `172.25.176.1`.

**How FreeSWITCH reacts:** it follows the new address automatically, because `vars.xml` sets `domain`, `external_rtp_ip` and `external_sip_ip` to `$${local_ip_v4}`. It also binds SIP to the current IP.

**Hard-coded addresses in the apps (variable names only):**

| File | Variable | Holds |
|---|---|---|
| `/opt/freeswitch-ui/fs-cc/backend/.env` | `FS_SIP_DOMAIN` | `172.21.20.57`, which is **the old laptop's WSL IP** |
| `/opt/freeswitch-ui/fs-enrs/backend/.env` | `SIP_DOMAIN` | `172.21.20.57` (old) |
| `/opt/freeswitch-ui/fs-enrs-dev/backend/.env` | `SIP_DOMAIN` | `192.168.1.133` (lab server) |
| `/opt/fs-cp/deploy/.env` | (3 entries) | `172.21.20.57` (old; FS-CP isn't authoritative) |

Everything else uses `127.0.0.1` or `localhost`, so ESL, the database and Redis are not affected by IP changes.

**Effect:**
- FS-CC builds agent contacts as `user/<ext>@<FS_SIP_DOMAIN>`, and FS-ENRS dials with `SIP_DOMAIN`.
- With the domain set to `172.21.20.57` while FreeSWITCH's domain is now `172.25.187.198`, user lookups and dial strings can fail to match the FreeSWITCH directory domain. This is **UNKNOWN until tested**, but it is the likely cause of the reported IP problem.

## Phase B — Compatibility

| Area | Finding | Verdict |
|---|---|---|
| FreeSWITCH and audio | 1.10.12 runs as a service; codec libraries (sndfile, opus, speexdsp, srtp and others, 9 packages), sox and ffmpeg are present; custom `enrs` sounds are in place | Healthy |
| Node | v22.22.1 meets FS-CC/FS-ENRS (`>=20`) and FS-WebRTC (`>=22`). **One gap:** `jsdom 31.0.0`, which CP-2 added to agent-desktop, needs Node **≥ 22.22.2**. npm 9.2.0 is old but reads lockfile v3 | Compatible, except that the agent-desktop tests need Node 22.22.2 or newer |
| PostgreSQL | 18.6, with the project databases present | Healthy; nothing to migrate |
| Redis | 8.0.5, local only | Healthy |
| FS-CC / FS-ENRS configuration | `.env` files exist; ESL, database and Redis use loopback; only the SIP-domain variables hold IPs | Needs a stable SIP domain (see Phase C) |
| WSL IP changes | FreeSWITCH adapts; the app `.env` domain values do not | Fixable by configuration |
| Docker | Not installed in either distro; the current stack runs on systemd and PM2, not Docker | Not required |
| Resources | One shared VM with 3.8 GiB RAM, out of 7.9 GB on the laptop. Running both distros shares that VM, but each adds a little overhead | Tight but adequate. Keep only one distro running day to day |
| Repository freshness | `/opt/freeswitch-ui/fs-enrs` is behind the laptop repository (`main@6ab4dc6` versus `fix/tenant-unification@63977bf`) and has 20 uncommitted entries | Reconcile before using it as the FS-ENRS work tree |

**Conclusion:** the restored environment can run the current repositories **without a rebuild**. There's no concrete technical reason to prefer the new `Ubuntu`.

## Phase C — Handling the changing WSL IP (no code changes)

**Recommended:** make the SIP domain a **fixed name** instead of an IP.

- **Name to use:** for example `pbx.local`, or whatever you pick; it's your decision.
- **FreeSWITCH:** set `domain=pbx.local` in `vars.xml`. Keep `external_rtp_ip` and `external_sip_ip` as `$${local_ip_v4}`, so media still follows the current IP.
- **Apps:** set `FS_SIP_DOMAIN` (FS-CC) and `SIP_DOMAIN` (FS-ENRS) to the same name.
- **Why this works:** a SIP domain is only a realm and directory key. It doesn't need to resolve to an IP for internal `user/` dialing. After this change, an IP change no longer touches any application setting.
- **Check needed:** **UNKNOWN until tested**. Confirm that the existing directory users and the WebRTC lab users register against the new realm, and that ENRS dial strings work.

**For anything that reaches the services:**
- **Inside WSL** (backends to ESL, PostgreSQL, Redis): keep `127.0.0.1`. That is already the case.
- **From Windows** (browser to the dev UIs): use `http://localhost:<port>`. WSL 2 forwards localhost to services that listen on all interfaces.
- **From LAN devices** (desk phones, other PCs to SIP/WSS): Windows needs a port forward to the current WSL IP. It can be refreshed at logon with a small script that reads `wsl hostname -I` and runs `netsh interface portproxy` for TCP 5060/5066/7443. SIP over UDP and RTP media cannot go through portproxy, so LAN audio testing should stay on the lab server 192.168.1.133.
- **Alternative later:** on Windows 11, `networkingMode=mirrored` removes the problem entirely.

## Required migration steps (proposed only; none were performed)

1. **Choose the SIP domain name.** Apply it to FreeSWITCH `vars.xml`, FS-CC `FS_SIP_DOMAIN` and FS-ENRS `SIP_DOMAIN`, back up each file first, then restart and test. This needs separate approval, because it touches FreeSWITCH and the `.env` files.
2. **Use Node ≥ 22.22.2 for agent-desktop tests in `Ubuntu-FS`.** Either use a user-local Node, as done in `Ubuntu`, or update the `nodejs` package. Needs approval.
3. **Reconcile `/opt/freeswitch-ui/fs-enrs`** with the laptop repository: review its 20 uncommitted entries before switching branches. Needs approval.
4. **Find out why the four PM2 apps are not listening** (`sudo pm2 ls`). Needs approval, because it talks to the daemon.
5. **Optional:** turn the Windows portproxy refresh script into a logon task.
6. **Keep `Ubuntu`** as a disposable build sandbox (`~/cp1-tools`, `~/cp1-fscc`, `~/cp2-fscc`), or unregister it later after separate approval.

## Risks and unresolved checks

- **Realm change:** whether every registered device and directory user works with a named domain is **UNKNOWN until tested**.
- **SIP and RTP from the LAN** to WSL under NAT are unreliable. Keep LAN and WebRTC audio tests on the lab server.
- **Root ownership:** the root-owned `/opt` repositories and the root PM2 daemon mean edits need `sudo`, and `git pull` must be run as root (the existing practice).
- **Memory:** 3.8 GiB VM. FreeSWITCH, PostgreSQL, Redis, Piper and the Node apps fit, but builds plus everything running could get tight. `.wslconfig` `memory=` could be raised later.
- **Windows Firewall rules** for portproxy are **UNKNOWN**.

## Confirmation

**Nothing in either distro or in any repository was modified.**

- **No changes:** no packages were installed or upgraded, no configuration or `.env` files were changed, and no repositories were changed, copied or migrated.
- **No access:** DEV and production servers weren't accessed.

**One side effect:**
- **What happened:** checking the PM2 version as user `user` in `Ubuntu-FS` (`pm2 -v`) **spawned an empty user-level PM2 daemon** under `/home/user/.pm2`. It runs no apps.
- **The root PM2 daemon:** untouched.
- **Cleanup, if wanted:** run `pm2 kill` as user `user`. That affects only this empty daemon.

**Other notes:**
- **Distros were already running:** both distros were in the Running state before the inventory, so nothing was started for it.
- **Report file:** this report is the only file created.
