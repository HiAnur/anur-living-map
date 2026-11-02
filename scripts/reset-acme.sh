#!/bin/bash
# Puts acme back to its pre-demo state for the next take: code at the demo-start tag on main, no plan.md or
# leftovers, fresh sample data, and its team map started over from the code. Whatever the last run left is
# kept first (uncommitted work in a stash, where main was under a backup tag), so nothing is lost.
#
#   reset-acme.sh          reset for the next take
#   reset-acme.sh --mark   make the current main the new pre-demo state (moves demo-start)
set -eu
A=${ACME:-$HOME/Documents/Projects/HeyAnurAI/acme}
MAP=${MAP_URL:-http://localhost:4323/acme}
cd "$A"
ts=$(date +%Y%m%d-%H%M%S)

if [ "${1:-}" = "--mark" ]; then
  if git rev-parse -q --verify demo-start >/dev/null; then git tag "backup-demo-start-$ts" demo-start; fi
  git tag -f demo-start main >/dev/null
  echo "demo-start now marks main: $(git log --oneline -1 demo-start)"
  exit 0
fi
git rev-parse -q --verify demo-start >/dev/null || { echo "No demo-start tag in $A: run reset-acme.sh --mark once on the clean main."; exit 1; }

# 1. keep what the last run left
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -q -m "demo run $ts"
  echo "kept the run's unsaved changes: git stash list ('demo run $ts')"
fi
if [ "$(git rev-parse main)" != "$(git rev-parse demo-start)" ]; then
  git tag "backup-demo-$ts" main
  echo "kept where main was: tag backup-demo-$ts"
fi

# 2. code back to demo-start, on main; branches a run made stay, listed
git switch -q main
git reset -q --hard demo-start
others=$(git branch --format='%(refname:short)' | grep -v '^main$' || true)
if [ -n "$others" ]; then echo "branches from earlier runs, kept: $(echo $others)"; fi

# 3. fresh sample data, no leftovers
rm -rf db/acme.db db/acme.db-wal db/acme.db-shm .outbox plan.md
npm run -s db >/dev/null

# 4. the map starts over from the code; the version before stays in its History
if curl -sf -X POST "$MAP/api/act" -H 'content-type: application/json' --data '{"type":"reset","by":"Duy"}' >/dev/null; then
  echo "map started over from the code: $MAP/"
else
  echo "the map server isn't answering: open the map with /anur-living-map in acme"
fi
echo "acme is ready for a take: $(git log --oneline -1)"
