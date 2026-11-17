# OPS-2 — Serve built pages on DEV instead of development servers (plan, for approval)

## Why
The DEV host (Ubuntu-FS, WSL on a 7.9 GB / 4-CPU laptop) gets 3.8 GB. The admin portal (:8000) and agent desktop (:8080) run as **Vite development servers** under pm2 (`npm run dev`). Measured 2026-11-16:

| Process | Memory |
|---|---|
| agent desktop Vite dev + npm wrapper | 160 + 89 MB |
| admin portal Vite dev + npm wrapper | 110 + 92 MB |
| (ENRS frontend :8100 Vite dev + npm — separate project, not in this pm2 list) | 168 + 85 MB |

A development server recompiles source files whenever a page is opened, so each page load causes a CPU spike. It is meant for coding, not for running.

## Change
Build the pages once at deploy time, then serve the finished files with `vite preview`. Preview uses the **same config** as today, so nothing else changes:
- same ports (8000, 8080), same HTTPS certificate on 8080 (`DEV_HTTPS_CERT/KEY` in `.env.local`), same `/api` and `/socket.io` proxy to the backend on :4000 (preview reuses `server.proxy` and `server.https`);
- same browser-phone settings (`VITE_WEBRTC_ENABLED`, `VITE_SIP_*`) — baked in at build time from DEV's own `.env.local`.

pm2 entries (`/opt/freeswitch-ui/fs-cc/ecosystem.config.js`) change from `npm run dev -- --host 0.0.0.0 --port N` to running Vite directly (no npm wrapper):
`node_modules/.bin/vite preview --host 0.0.0.0 --port N --strictPort`.

## New deploy routine (frontend changes)
1. `git pull` (as today).
2. `npm run build` in `frontend` and/or `agent-desktop` (only the one that changed; ~1–2 min each on this host).
3. `pm2 restart fs-frontend` / `fs-agent`.
Backend deploys are unchanged. I would add a small script `scripts/dev-deploy.sh` that does these steps and stops if the build fails (the old pages keep running).

## Expected effect
- About 350–450 MB less memory (two Vite dev servers + two npm wrappers → two light file servers).
- No CPU spike on page loads; pages load faster (one bundled file set instead of hundreds of modules).
- Cost: a frontend deploy takes 1–2 min longer (the build), and the page no longer refreshes by itself after a pull — a Ctrl+F5 is needed (agents need that today anyway).

## Rule: code changes only in the laptop repo
- `ecosystem.config.js` and the new `scripts/dev-deploy.sh` are tracked in git; both are edited **only** in `C:\Users\naresh\Documents\fs-cc`, committed, pushed, and reach DEV by `git pull --ff-only`.
- On DEV nothing is edited by hand. DEV only runs: `git pull`, `npm run build` (writes `dist/`, which git ignores), and `pm2` commands.
- DEV-only settings (`.env`, `.env.local`, certificates) are not touched.

## Steps (each only after owner approval)
1. Laptop repo: add the build-then-restart script and update `ecosystem.config.js`; commit and push.
2. On DEV: pull, build both apps, `pm2 reload` the two entries, `pm2 save`.
3. Verify: 8000 and 8080 load over the same URLs, sign-in works, live updates (socket) work, browser phone registers on 8080, memory measured again.
4. Rollback (≈1 min): `pm2` back to `npm run dev` for both entries (old ecosystem file kept in git).

## Not included
- ENRS frontend on :8100 (separate project, started outside this pm2 list) — same fix would save ~250 MB; needs its own approval.
- Production setup (nginx etc.) — unchanged; this is DEV only.
- Slow database queries (0.5–0.8 s) — separate small task.

## Done (2026-11-16, commit 448dcdd)
- DEV pulled, both apps built (admin 55 s, agent 25 s), pm2 entries switched and saved.
- Checks: 8000 and 8080 answer 200; `/api` proxy works on both (8080 over HTTPS); agent desktop loads the built bundle (no dev client), stays signed in, status badge only "Warning (Phone)" = server, live updates and SIP engine OK; browser phone panel present.
- Memory: the two page services now 130 + 134 MB (was 110 + 160 + 92 + 89 = 451 MB) → about 185 MB saved; no per-page recompiling.
- From now on frontend deploys use `scripts/dev-deploy.sh frontend|agent|backend` on DEV.
