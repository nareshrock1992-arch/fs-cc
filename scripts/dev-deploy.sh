#!/bin/bash
# DEV deploy: pull from the laptop-pushed main, rebuild the pages that changed, restart.
# Run on Ubuntu-FS as root. Edits nothing tracked by git; builds write dist/ (git-ignored).
# Usage: scripts/dev-deploy.sh [frontend] [agent] [backend]   (no argument = all)
set -euo pipefail
ROOT=/opt/freeswitch-ui/fs-cc
cd "$ROOT"
targets="${*:-frontend agent backend}"

(timeout 20 git pull -q --ff-only origin main || git -c safe.directory='*' pull -q --ff-only /mnt/c/Users/naresh/Documents/fs-cc main)
echo "at $(git log --oneline -1)"

build() { # $1 = folder, $2 = pm2 name. Builds into dist.new; the running pages stay until it succeeds.
  echo "== building $1"
  ( cd "$ROOT/$1" && npx vite build --outDir dist.new --emptyOutDir >/tmp/build-$1.log 2>&1 ) || {
    echo "BUILD FAILED for $1 — old pages kept. See /tmp/build-$1.log"; tail -20 /tmp/build-$1.log; exit 1; }
  rm -rf "$ROOT/$1/dist.old"
  [ -d "$ROOT/$1/dist" ] && mv "$ROOT/$1/dist" "$ROOT/$1/dist.old"
  mv "$ROOT/$1/dist.new" "$ROOT/$1/dist"
  pm2 restart "$2" --update-env >/dev/null
  echo "$1 deployed"
}

for t in $targets; do
  case "$t" in
    frontend) build frontend fs-frontend ;;
    agent)    build agent-desktop fs-agent ;;
    backend)  pm2 restart fs-backend >/dev/null; echo "backend restarted" ;;
    *) echo "unknown target $t"; exit 2 ;;
  esac
done
