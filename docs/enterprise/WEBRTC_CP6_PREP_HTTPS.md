# CP-6 Preparation: HTTPS for the Agent Desktop dev server

Date: 2026-11-08. Owner decision: **serve the Agent Desktop over Vite HTTPS** for the lab (browsers only allow the microphone in a secure context).

## Change (laptop, not committed)

`agent-desktop/vite.config.js`: optional HTTPS for the dev server.
- **On only when both** `DEV_HTTPS_CERT` and `DEV_HTTPS_KEY` are set (file paths).
- **No `VITE_` prefix,** so the paths never reach the browser bundle.
- **No new dependency** (uses `node:fs`).
- **Without the variables,** the server runs plain HTTP exactly as before. The production build is unaffected.

## Certificate

| Item | Value |
|---|---|
| Issued by | mkcert v1.4.4 local CA (`C:\Users\naresh\AppData\Local\mkcert`, created 2026-11-07) |
| Names (SAN) | `192.168.1.124`, `localhost`, `127.0.0.1` |
| Expires | 2029-02-08 |
| Laptop copy | `C:\Users\naresh\.fs-certs\agent-desktop-lan.pem` and `…-key.pem` (outside every repository) |
| Ubuntu-FS copy | `/root/certs/` (dir 700; key **600**, cert 644; owner root) |
| In Git | **No** |

The key was never printed. **`rootCA-key.pem` must never be copied or shared.**

## Verified (scratch copy, temporary servers stopped afterwards)

| Test | Result |
|---|---|
| Tests / build | 8 files / 103 tests passed; build unchanged (`index-CjHCLFm9.js` 236.42 kB, CSS identical) |
| `https://192.168.1.124:18443/` with both variables | **200**, served with the new certificate (SAN as above) |
| Plain `http://` on that port | refused |
| Without the variables (`http://127.0.0.1:18080/`) | **200**: HTTP as before |
| Leftover processes | none |

## Steps for the owner (trust: a security setting, so done by you)

1. **This laptop:** mkcert reports its CA is **not yet in the Windows trust store**. In a normal PowerShell run:
   ```
   mkcert -install
   ```
   Windows shows a security warning to confirm adding the CA. After that, Edge and Chrome trust `https://192.168.1.124:8080`.
2. **Other LAN PCs** (optional): import **only** `rootCA.pem` (never `rootCA-key.pem`) into "Trusted Root Certification Authorities". Alternatively, accept the browser warning once.
3. **FreeSWITCH WSS (7443)** still uses its own self-signed certificate (`CN=FreeSWITCH`, no SAN; `wss.pem` is not replaced). Open `https://192.168.1.124:7443` once in the same browser and accept the warning. Otherwise the phone can't connect.

## How CP-6 will start the Agent Desktop (needs approval: app start)

```bash
export PATH=/root/.local/node-v22.23.4/bin:$PATH   # or system node; Vite 6 runs on 22.22.1 too
cd /opt/freeswitch-ui/fs-cc/agent-desktop
DEV_HTTPS_CERT=/root/certs/agent-desktop-lan.pem DEV_HTTPS_KEY=/root/certs/agent-desktop-lan-key.pem \
VITE_WEBRTC_ENABLED=true VITE_SIP_DOMAIN=192.168.1.124 VITE_SIP_WSS_URL=wss://192.168.1.124:7443 \
npm run dev -- --host 0.0.0.0 --port 8080
```
The PM2 `fs-agent` entry (`npm run dev -- --host 0.0.0.0 --port 8080`) would need these variables in its environment. That is a PM2 configuration decision for CP-6.

## Still open for CP-6

- Approval to commit and push this change (`vite.config.js` plus this note).
- **The four agent contacts** (`@172.21.20.57` → `@192.168.1.124`, ids 1, 2, 303, 3525): one reversible transaction.
- **Starting the FS-CC backend and the Agent Desktop** on Ubuntu-FS.
