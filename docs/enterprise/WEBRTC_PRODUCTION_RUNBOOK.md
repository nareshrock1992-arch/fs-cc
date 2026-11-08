# WebRTC browser phone: production runbook (offline-ready)

Written 2026-11-08, from the Ubuntu-FS lab bring-up (CP-6). The production server has **no internet**, so this page covers everything needed to install, verify and troubleshoot the browser phone without outside help.

Read top to bottom on the first install. When something breaks, go to §6 (symptom → cause → fix).

---

## 1. How the pieces fit

```
Agent's browser (Chrome/Edge)
  │ 1. HTTPS page            https://<SERVER_IP>:8080   (Agent Desktop, Vite or built files)
  │ 2. SIP over secure WS    wss://<SERVER_IP>:7443     (FreeSWITCH, profile "internal")
  │ 3. Audio (SRTP over UDP) <SERVER_IP>:16384–32768    (FreeSWITCH RTP ports)
  ▼
FreeSWITCH ── mod_callcenter ── agent contact  user/<ext>@<SIP_DOMAIN>
  ▲
FS-CC backend (writes the agent contact from FS_SIP_DOMAIN)
```

All three paths must work. Signalling (1 and 2) working does **not** prove audio (3) works.

## 2. Values that must agree

| Where | Setting | Must equal |
|---|---|---|
| FreeSWITCH `vars.xml` | `domain` (default `$${local_ip_v4}`) | the server's LAN IP or chosen SIP domain |
| FS-CC `backend/.env` | `FS_SIP_DOMAIN` | the same domain |
| Agent Desktop environment | `VITE_SIP_DOMAIN` | the same domain |
| Agent Desktop environment | `VITE_SIP_WSS_URL` | `wss://<SERVER_IP>:7443` |
| Agent Desktop environment | `VITE_WEBRTC_ENABLED` | `true` (otherwise the panel is not built in) |
| FreeSWITCH `sip_profiles/internal.xml` | `apply-candidate-acl` | `localnet.auto` (see §4) |

**Lesson from the lab:** the agent contact is written once, when the agent is saved. If `FS_SIP_DOMAIN` was wrong at that time, fixing `.env` later does not fix existing agents. Restart the backend, then re-save (or delete and re-create) each internal agent. Check with:
```sql
select id, agent_type, contact from agents order by id;   -- every internal contact must end @<SIP_DOMAIN>
```

## 3. Certificates (no internet, so no public CA)

Browsers allow the microphone only on HTTPS, and the phone needs a trusted `wss://`.

1. Create a local CA and a server certificate with **mkcert** on any machine (copy the `mkcert` binary in advance). Include the server IP and the host name in the certificate:
   ```
   mkcert -cert-file agent-desktop.pem -key-file agent-desktop-key.pem <SERVER_IP> <hostname> localhost 127.0.0.1
   ```
2. Place them on the server in `/root/certs/` (folder mode 700, key 600). **Never** copy `rootCA-key.pem` anywhere.
3. On every agent PC: import **only** `rootCA.pem` into Windows *Trusted Root Certification Authorities* (or push it with Group Policy). Do this before go-live.
4. FreeSWITCH WSS (7443) uses `certs_dir/wss.pem`. Either
   - keep its self-signed certificate, and on each agent PC open `https://<SERVER_IP>:7443` once and accept the warning (a blank or "400" page afterwards is normal); or, better for production,
   - build `wss.pem` from the mkcert certificate (cert + key + CA chain in one file), back up the old one, and restart the internal profile. Then no warning is needed anywhere.

## 4. FreeSWITCH settings for a LAN-only server

In `sip_profiles/internal.xml`, next to `wss-binding`:
```xml
<param name="wss-binding" value=":7443"/>
<param name="apply-candidate-acl" value="localnet.auto"/>
```
**Why:** without `apply-candidate-acl`, FreeSWITCH logs `NO candidate ACL defined, Defaulting to wan.auto` and accepts only *public* addresses for browser audio. On a private network every browser address is private, so every answered call drops at once with `INCOMPATIBLE_DESTINATION` (cause 88). This was the lab fault on 2026-11-08.

- `localnet.auto` = the subnet the server itself is on. If agents sit on **other subnets** (different VLANs), define an ACL in `autoload_configs/acl.conf.xml` instead, e.g.
  ```xml
  <list name="webrtc_agents" default="deny">
    <node type="allow" cidr="10.20.0.0/16"/>
    <node type="allow" cidr="192.168.1.0/24"/>
  </list>
  ```
  and use `value="webrtc_agents"`. Then `reloadacl`.
- Keep `ext-rtp-ip` and `ext-sip-ip` as the server's own LAN IP (no public IP, no STUN), as there is no NAT to the internet.
- Codecs: `global_codec_prefs` must include `OPUS` and `PCMU`/`PCMA` (browsers support these; G.729 is not available in browsers).

Apply safely:
```bash
cp -p internal.xml internal.xml.bak-$(date +%Y%m%d-%H%M%S)
# edit
fs_cli -x reloadxml
fs_cli -x "sofia profile internal restart"   # phones on this profile drop for a few seconds and re-register
```

## 5. Network / firewall (server and agent PCs)

| Port | Proto | Direction | Purpose |
|---|---|---|---|
| 8080 (or the chosen web port) | TCP | agent → server | Agent Desktop page (HTTPS) |
| 7443 | TCP | agent → server | SIP over WSS |
| 16384–32768 (`rtp-start-port`/`rtp-end-port` in `switch.conf.xml`) | **UDP** | both ways | audio |
| 4000 | TCP | local only | FS-CC backend (reached through the page's `/api` proxy) |

UDP to the RTP range is the one most often blocked by a corporate firewall. Signalling will look fine and the call drops or is silent.

## 6. Troubleshooting without outside help

Tools: the browser console (**F12 → Console**; the phone logs every SIP message), `fs_cli`, and `/opt/freeswitch/var/log/freeswitch/freeswitch.log` (use `grep -a`).

| Symptom | Where to look | Cause | Fix |
|---|---|---|---|
| Page won't open on `https://…:8080` | browser | Agent Desktop started without the certificate variables, or not running | Start with `DEV_HTTPS_CERT`/`DEV_HTTPS_KEY` set (§7); `pm2 describe fs-agent` |
| Browser warns "not private" on 8080 | browser | rootCA not trusted on this PC | §3 step 3 |
| Phone panel missing | page | `VITE_WEBRTC_ENABLED` not `true` at start/build | Restart with the variable (§7) |
| "Not available" in the panel | panel | Agent is a gateway agent, or the contact isn't `user/<ext>@domain` | §2 contact check |
| Phone never says "Phone ready"; console shows WebSocket error | console | 7443 blocked, or WSS certificate not trusted | Open `https://<IP>:7443` once / fix certs (§3.4); check firewall |
| Console shows `401` then `403` | console | Wrong SIP password, or extension doesn't exist in `directory/default/` | Check `directory/default/<ext>.xml` |
| Panel "ready", but queue log says `USER_NOT_REGISTERED` | `fs_cli -x "show registrations"` | Phone signed out / tab closed / registration expired (300 s) | Keep the tab open; sign in again |
| Call never rings in the browser | log `grep -a <ext>` | Agent contact has the wrong domain | §2 |
| **Rings, Answer pressed, call drops at once; BYE with `INCOMPATIBLE_DESTINATION`** | log: `NO candidate ACL defined, Defaulting to wan.auto` and `no suitable candidates found` | Candidate ACL missing | §4 |
| Call connects but no audio / one-way audio | browser `chrome://webrtc-internals`; log `ICE`/`DTLS` | UDP RTP range blocked, or wrong `ext-rtp-ip` | §5, §4 |
| No sound until clicking the page | panel | Browser autoplay rule | Click "Enable sound" once |
| Microphone prompt never appears | browser | Page opened over `http://` | Use `https://` |

Useful commands:
```bash
fs_cli -x "show registrations"                       # who is registered (WSS phones show transport ws/wss)
fs_cli -x "sofia status profile internal reg <ext>"
fs_cli -x "callcenter_config agent list"             # contacts as mod_callcenter sees them
fs_cli -x "sofia global siptrace on"                 # temporary SIP trace; turn OFF afterwards
grep -a "INCOMPATIBLE\|candidate\|DTLS" /opt/freeswitch/var/log/freeswitch/freeswitch.log | tail
ss -ltn | grep -E ':(7443|8080) '
pm2 describe fs-agent ; pm2 logs fs-agent --nostream --lines 30
```

## 7. Starting the Agent Desktop with the phone

```bash
export DEV_HTTPS_CERT=/root/certs/agent-desktop.pem
export DEV_HTTPS_KEY=/root/certs/agent-desktop-key.pem
export VITE_WEBRTC_ENABLED=true
export VITE_SIP_DOMAIN=<SIP_DOMAIN>
export VITE_SIP_WSS_URL=wss://<SERVER_IP>:7443
pm2 restart fs-agent --update-env && pm2 save
```
Only non-secret values go here. The SIP password is typed by the agent and kept in memory only.

## 8. Go-live checklist (tick every line on the production server)

- [ ] `FS_SIP_DOMAIN`, `vars.xml` domain and `VITE_SIP_DOMAIN` are identical (§2)
- [ ] Every internal agent contact ends `@<SIP_DOMAIN>` (SQL in §2)
- [ ] `apply-candidate-acl` set in `internal.xml`; internal profile restarted (§4)
- [ ] Server certificate in `/root/certs`; rootCA trusted on every agent PC (§3)
- [ ] `https://<IP>:7443` trusted (or `wss.pem` replaced) on every agent PC (§3.4)
- [ ] Firewall allows TCP 8080, TCP 7443, UDP 16384–32768 (§5)
- [ ] `fs-agent` restarted with the variables in §7; `pm2 save` done
- [ ] Test 1: agent signs into the phone → panel "Phone ready" and `show registrations` lists the extension
- [ ] Test 2: desk phone calls the agent extension → rings → Answer → **two-way audio for 30 s** → hang up from each side
- [ ] Test 3: queue call → mod_callcenter rings the browser → answer → audio
- [ ] Test 4: Log Out in the Agent Desktop → extension disappears from `show registrations`
- [ ] Backups of every changed file kept with date stamps

## 9. Lab record (Ubuntu-FS, 2026-11-08)

| Change | Backup / rollback |
|---|---|
| `internal.xml`: added `apply-candidate-acl=localnet.auto` after `wss-binding` (line 326); `reloadxml`; `sofia profile internal restart`. 1000 (browser) and 1001 (MicroSIP) re-registered on their own | `/opt/freeswitch/etc/freeswitch/sip_profiles/internal.xml.bak-20261108-111022-candidate-acl` → copy back, `reloadxml`, restart profile |
| PM2 `fs-agent` restarted with HTTPS and phone variables; `pm2 save` | `/root/backups/dump.pm2.bak-20261108-cp6` |
| FS-CC `backend/.env` `FS_SIP_DOMAIN` 172.21.20.57 → 192.168.1.124 (by owner); agents re-created by owner (ids 3995–3998) | owner's backup |

Open items found during the lab test:
- The panel has no **dial pad** (outgoing calls) or **call history** yet. CP-5 shipped answer/reject/mute/hang-up only. Planned as the next build step.
- FS-ENRS `SIP_DOMAIN` still says 172.21.20.57 (FS-ENRS is out of scope; owner to decide).
- The browser offers a video track; audio-only is enough for agents (low priority clean-up).
