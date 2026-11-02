#!/bin/bash
# Puts acme back to its pre-demo state for the next take: code at the demo-start tag on main, no plan.md or
# leftovers, fresh sample data, and its team map started over from the code. Whatever the last run left is
# kept first (uncommitted work in a stash, where main was under a backup tag), so nothing is lost.
#
#   reset-acme.sh          reset for the next take
#   reset-acme.sh --mark   make the current main the new pre-demo state (moves demo-start)
#   reset-acme.sh --questions   only the questions: the map goes back to how Claude drew it, before the
#                               first answer, so they can be answered again; code and data stay as they are
set -eu
A=${ACME:-$HOME/Documents/Projects/HeyAnurAI/acme}
MAP=${MAP_URL:-http://localhost:4323/acme}
cd "$A"
ts=$(date +%Y%m%d-%H%M%S)

if [ "${1:-}" = "--questions" ]; then
  # the version just before the first answer since the map last started over, from the map's History
  pick=$(node -e '
    const fs = require("fs"), dir = process.argv[1] + "/.living-map/history";
    const h = JSON.parse(fs.readFileSync(dir + "/index.json", "utf8"));
    let first = -1;
    for (let i = 0; i < h.length && h[i].kind !== "reset" && h[i].kind !== "start"; i++) if (h[i].kind === "call") first = i;
    const v = first >= 0 && h[first + 1];
    if (v) console.log(v.id + "\t" + v.what);' "$A")
  if [ -z "$pick" ]; then echo "no answers to undo: every question is still open"; exit 0; fi
  id=${pick%%$'\t'*}; what=${pick#*$'\t'}
  curl -sf -X POST "$MAP/api/act" -H 'content-type: application/json' --data "{\"type\":\"restore\",\"id\":\"$id\",\"by\":\"Duy\"}" >/dev/null \
    || { echo "the map server isn't answering: open the map with /anur-living-map in acme"; exit 1; }
  # what the chat hears loses the answers too: the outbox ends where that version was drawn
  node -e '
    const fs = require("fs"), f = process.argv[1], what = process.argv[2];
    if (!fs.existsSync(f)) process.exit();
    const lines = fs.readFileSync(f, "utf8").split("\n"), at = lines.findLastIndex((l) => l.slice(8) === what);
    if (at >= 0) fs.writeFileSync(f, lines.slice(0, at + 1).join("\n") + "\n");' "$A/.living-map/outbox.md" "$what"
  # plan.md was written from the answers; it is kept in a stash, like a full reset does
  if [ -e plan.md ]; then git stash push -u -q -m "plan.md from run $ts" -- plan.md; echo "kept plan.md: git stash list ('plan.md from run $ts')"; fi
  echo "questions open again on $MAP/ (back to: $what)"
  exit 0
fi

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
