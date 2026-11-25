#!/bin/bash
# FS-CC browser smoke tests on an isolated local stack, in the DEV distro ("Ubuntu") only.
#   bash e2e/run.sh            (from a copy of the fs-cc repo with backend/frontend/agent-desktop deps)
#
# Isolation (WSL distros share ONE network with the lab Ubuntu-FS):
#   - PostgreSQL: dev socket, port 5433, throwaway database fs_cc_e2e (lab DB is 5432)
#   - ports: backend 14000, admin 18000, agent desktop 18080 (lab uses 4000/8000/8080)
#   - FreeSWITCH ESL: 127.0.0.1:65021, a closed port, so nothing can reach the lab FreeSWITCH (8021)
#   - pages bound to 127.0.0.1; sign-ins generated per run, kept only in this process's environment
set -euo pipefail
[ -d /opt/freeswitch ] && { echo "STOP: this is the lab distro. Run in the dev distro 'Ubuntu'."; exit 1; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOG=${E2E_LOG_DIR:-$ROOT/e2e/.logs}; mkdir -p "$LOG"

export PGHOST=/var/run/postgresql PGPORT=5433
export DB_HOST=/var/run/postgresql DB_PORT=5433 DB_NAME=fs_cc_e2e DB_USER=$USER DB_PASSWORD=
export NODE_ENV=development PORT=14000 BUSINESS_TIMEZONE=UTC JWT_SECRET=$(openssl rand -hex 32)
export FS_ESL_HOST=127.0.0.1 FS_ESL_PORT=65021 FS_ESL_PASSWORD=closed-port FS_SIP_DOMAIN=127.0.0.1
export CORS_ORIGIN=http://localhost:18000,http://localhost:18080,http://127.0.0.1:18000,http://127.0.0.1:18080
unset TELEPHONY_MODE SIP_RELAY_UPSTREAM_URL
export VITE_BACKEND_DEV_URL=http://127.0.0.1:14000
export E2E_ADMIN_USER=e2e_admin E2E_ADMIN_PASS=$(openssl rand -hex 12) E2E_SUP_PASS=$(openssl rand -hex 12)
export E2E_API_URL=http://127.0.0.1:14000
export E2E_AGENT_ID=e2e_agent@default E2E_AGENT_PIN=$(shuf -i 100000-999999 -n 1)
export E2E_ADMIN_URL=http://127.0.0.1:18000 E2E_AGENT_URL=http://127.0.0.1:18080

for p in 14000 18000 18080; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && { echo "STOP: port $p already in use."; exit 1; }; done
for d in backend frontend agent-desktop e2e; do [ -d "$ROOT/$d/node_modules" ] || (cd "$ROOT/$d" && npm ci --no-audit --no-fund >/dev/null); done

PIDS=()
# Each server runs in its own process group (setsid), so stopping it also stops children (npx → vite).
cleanup() {
  for p in "${PIDS[@]}"; do kill -TERM -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  dropdb --if-exists fs_cc_e2e 2>/dev/null || true
}
trap cleanup EXIT

dropdb --if-exists fs_cc_e2e; createdb fs_cc_e2e
node "$ROOT/e2e/seed.mjs"

(cd "$ROOT/backend" && exec setsid node server.js) >"$LOG/backend.log" 2>&1 & PIDS+=($!)
(cd "$ROOT/frontend" && exec setsid npx vite --host 127.0.0.1 --port 18000 --strictPort) >"$LOG/admin.log" 2>&1 & PIDS+=($!)
(cd "$ROOT/agent-desktop" && exec setsid npx vite --host 127.0.0.1 --port 18080 --strictPort) >"$LOG/agent.log" 2>&1 & PIDS+=($!)

wait_for() { for i in $(seq 1 60); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done; echo "STOP: $1 did not start (see $LOG)"; return 1; }
wait_for http://127.0.0.1:14000/api/health
wait_for "$E2E_ADMIN_URL/"
wait_for "$E2E_AGENT_URL/"
echo "stack up: backend 14000, admin 18000, agent 18080 (db fs_cc_e2e)"

cd "$ROOT/e2e" && npx playwright test "$@"
