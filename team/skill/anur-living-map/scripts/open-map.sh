#!/bin/bash
# Opens a team map in one go and does nothing that is already done: the server (started only when it is
# not answering), this repo on its list of maps, the map in Chrome (the tab already showing it comes to
# the front, or a new tab opens), and this chat linked to the map. One line per step.
#
#   open-map.sh          this repo's own map, at localhost:4323/<folder name>/
#   open-map.sh gtm      another map on the same server, at localhost:4323/gtm/
set -u
R="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; M="${1:-$(basename "$R")}"
S="${LIVING_MAP_HOME:-$HOME/anur-living-map}/team/live/server.js"
U="http://localhost:4323/$M/"
[ -f "$S" ] || { echo "Living Map server not found at $S"; exit 1; }

# 1. the server; never stopped or restarted, since other repos' maps and other chats' listeners live on it
if curl -sf localhost:4323/api/maps >/dev/null; then echo "server: already running"
else
  mkdir -p "$R/.living-map"; nohup node "$S" 4323 --project "$R" > "$R/.living-map/server.log" 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 0.3; curl -sf localhost:4323/api/maps >/dev/null && break; done
  echo "server: started for $R"
fi

# 2. this repo's map on the server's list (nothing changes when it is there); the map keeps what it was left with
if [ "$M" = "$(basename "$R")" ]; then
  out=$(curl -s -X POST localhost:4323/api/projects -H 'content-type: application/json' --data "{\"folder\":\"$R\"}")
  case "$out" in *'"error"'*) echo "map: could not add $R: $out"; exit 1;; esac
  git -C "$R" check-ignore -q .living-map/ 2>/dev/null || echo "gitignore: add .living-map/ to $R/.gitignore (it holds the map's state)"
fi
curl -s -X POST "${U}api/act" -H 'content-type: application/json' --data '{"type":"open","by":"Claude"}' >/dev/null
curl -s "${U}api/history" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{let h=[];try{h=JSON.parse(s)}catch{}
console.log(`map: ${process.argv[1]}, ${h.length>1?`as it was left, ${h.length} versions in History`:"fresh"}`)})' "$U"

# 3. the map in Chrome: the tab already on it comes to the front, otherwise a new tab
how=$(osascript - "$U" 2>/dev/null <<'OSA'
on run {u}
  if application "Google Chrome" is not running then return "none"
  tell application "Google Chrome"
    repeat with w in windows
      set i to 0
      repeat with t in tabs of w
        set i to i + 1
        if URL of t starts with u then
          set active tab index of w to i
          set index of w to 1
          activate
          return "front"
        end if
      end repeat
    end repeat
  end tell
  return "none"
end run
OSA
)
if [ "$how" = front ]; then echo "chrome: already open on the map, brought to the front"
else open -a "Google Chrome" "$U" && echo "chrome: opened $U"; fi

# 4. this chat linked to the map, so the map's Claude pane shows it and what is typed there comes here
if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  F=$(ls ~/.claude/projects/*/"$CLAUDE_CODE_SESSION_ID".jsonl 2>/dev/null | head -1)
  curl -s -X POST "${U}api/act" -H 'content-type: application/json' \
    --data "{\"type\":\"link\",\"by\":\"${LIVING_MAP_ME:-$(id -F 2>/dev/null | cut -d' ' -f1)}\",\"session\":\"$CLAUDE_CODE_SESSION_ID\",\"file\":\"$F\"}" >/dev/null
  echo "chat: linked to the map"
else echo "chat: not linked (no session id)"; fi
