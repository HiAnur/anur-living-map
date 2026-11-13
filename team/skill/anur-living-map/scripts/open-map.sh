#!/bin/bash
# Opens a team map in one go and does nothing that is already done: the latest code (cloned, pulled, the skill's
# copy refreshed), the server (started when it is not answering, restarted when its code is older), this repo on its list of maps, the map in Chrome (the tab already showing it comes to
# the front, or a new tab opens), and this chat linked to the map. One line per step.
#
#   open-map.sh          this repo's own map, at localhost:4323/<folder name>/
#   open-map.sh gtm      another map on the same server, at localhost:4323/gtm/
#
# ANUR_LIVING_MAP_PORT serves on another port, and ANUR_LIVING_MAP_NO_BROWSER=1 leaves Chrome alone (a test runs this
# script against a stand-in server with both).
#
# It runs the same from a Claude Code chat or a Pi chat: each says which chat it is in its own variable.
set -u
SID="${CLAUDE_CODE_SESSION_ID:-${PI_SESSION_ID:-}}"
P="${ANUR_LIVING_MAP_PORT:-4323}"
R="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# a map's address is its folder's name in lowercase letters, digits and dashes, as the server names it (PiTrade -> pitrade)
name_of() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//'; }
M="$(name_of "${1:-$(basename "$R")}")"
# the clone: ANUR_LIVING_MAP_HOME, else LIVING_MAP_HOME as it was named before
H="${ANUR_LIVING_MAP_HOME:-${LIVING_MAP_HOME:-$HOME/anur-living-map}}"; S="$H/team/live/server.js"
U="http://localhost:$P/$M/"
# the team map's data folder, as team/live/data-dir.js picks it: the old ~/.living-map-2 while it is the only one
D="$HOME/.anur-living-map"; [ ! -d "$D" ] && [ -d "$HOME/.living-map-2" ] && D="$HOME/.living-map-2"
REV="$D/server.rev"   # the commit the running server was started from

# 0. the latest, with nothing to do by hand: the repo is cloned when it is missing, moved to the newest release (the
#    v* tag CI puts on a push to main that passed its checks, never main itself) when it is on main with no changes
#    of its own (a few seconds at most; offline it gives up after a moment and says so), and the skill's copy this
#    script runs from (~/.claude/skills, ~/.agents/skills) follows, for the next time it is read. ANUR_LIVING_MAP_NO_UPDATE=1 leaves the clone as it is.
if [ ! -e "$H/.git" ]; then
  git clone -q https://github.com/HiAnur/anur-living-map.git "$H" && echo "install: cloned $H" || { echo "install: could not clone anur-living-map into $H"; exit 1; }
fi
[ -f "$S" ] || { echo "Living Map server not found at $S"; exit 1; }
was=$(git -C "$H" rev-parse HEAD); br=$(git -C "$H" branch --show-current)
if [ "${ANUR_LIVING_MAP_NO_UPDATE:-}" = 1 ]; then echo "update: skipped, ANUR_LIVING_MAP_NO_UPDATE is set"
elif [ "$br" != main ]; then echo "update: skipped, $H is on $br"
elif [ -n "$(git -C "$H" status --porcelain --untracked-files=no)" ]; then echo "update: skipped, $H has changes of its own"
elif git -C "$H" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=4 fetch -q --tags origin main 2>/dev/null \
  && rel=$(git -C "$H" describe --tags --abbrev=0 --match 'v[0-9]*' origin/main 2>/dev/null) \
  && git -C "$H" merge -q --ff-only "$rel" 2>/dev/null; then
  now=$(git -C "$H" rev-parse HEAD)
  if [ "$now" = "$was" ]; then echo "update: already the latest"
  else
    echo "update: $(git -C "$H" rev-list --count "$was..$now") new commits pulled: $(git -C "$H" log -1 --format=%s)"
  fi
else echo "update: could not reach GitHub, staying with what is here"; fi
# the skill's copy this script runs from always matches the clone, however the clone got its latest (this pull,
# the server's own, a pull by hand). Each file is replaced through a rename, never written in place: bash reads
# this very script by offset while it runs, so writing over it would tear it mid-line.
SK="$H/team/skill/anur-living-map"; SD="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$(cd "$SK" && pwd)" != "$SD" ] && ! diff -rq "$SK" "$SD" >/dev/null 2>&1; then
  (cd "$SK" && find . -type f) | while read -r f; do mkdir -p "$(dirname "$SD/$f")"; cp "$SK/$f" "$SD/$f.new" && mv -f "$SD/$f.new" "$SD/$f"; done
  echo "skill: copy refreshed from the clone, read from the next /anur-living-map on"
fi

# 1. the server. Running older code than the clone, it is restarted on the new code (the list of maps and every
#    map are on disk, so nothing is lost; listeners in other chats end and say to open the map again). Otherwise
#    it is never stopped or restarted, since other repos' maps and other chats' listeners live on it.
start_server() {
  mkdir -p "$R/.living-map" "$(dirname "$REV")"; git -C "$H" rev-parse HEAD > "$REV"
  nohup node "$S" "$P" --project "$R" > "$R/.living-map/server.log" 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 0.3; curl -sf localhost:$P/api/maps >/dev/null && break; done
}
if curl -sf localhost:$P/api/maps >/dev/null; then
  if [ "$(cat "$REV" 2>/dev/null)" = "$(git -C "$H" rev-parse HEAD)" ]; then echo "server: already running"
  else
    kill $(lsof -ti tcp:"$P" -sTCP:LISTEN) 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 0.3; curl -sf localhost:$P/api/maps >/dev/null || break; done
    start_server; echo "server: restarted on the new code"
  fi
else start_server; echo "server: started for $R"; fi

# 2. this repo's map on the server's list (nothing changes when it is there); the map keeps what it was left with.
#    The server answers with the map's address, and that answer is the address used: the server names maps, not this script.
if [ "$M" = "$(name_of "$(basename "$R")")" ]; then
  out=$(curl -s -X POST localhost:$P/api/projects -H 'content-type: application/json' --data "{\"folder\":\"$R\"}")
  case "$out" in *'"error"'*) echo "map: could not add $R: $out"; exit 1;; esac
  named=$(printf '%s' "$out" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p'); [ -n "$named" ] && { M="$named"; U="http://localhost:$P/$M/"; }
  git -C "$R" check-ignore -q .living-map/ 2>/dev/null || echo "gitignore: add .living-map/ to $R/.gitignore (it holds the map's state)"
fi
# 2b. a repo a system map was drawn from opens on that map, at the repo's own box (unless a map was named)
OPEN="$U"
if [ -z "${1:-}" ]; then
  sys=$(curl -s -G localhost:$P/api/maps/system-of --data-urlencode "folder=$R")
  sname=$(printf '%s' "$sys" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p'); shref=$(printf '%s' "$sys" | sed -n 's/.*"href":"\([^"]*\)".*/\1/p')
  if [ -n "$sname" ] && [ -n "$shref" ]; then
    M="$sname"; U="http://localhost:$P/$M/"; OPEN="http://localhost:$P$shref"
    echo "system map: $M, drawn from this repo; it opens on the repo's box (listen to the map $M)"
  fi
fi
curl -s -X POST "${U}api/act" -H 'content-type: application/json' --data '{"type":"open","by":"Claude"}' >/dev/null
# what is on it, so the chat says what is really there: a repo's own map with no boxes offers Draw this repo
OWN=$([ "$OPEN" = "$U" ] && [ "$M" = "$(name_of "$(basename "$R")")" ] && echo 1)
node -e 'const [u, own] = process.argv.slice(1), get = (p, none) => fetch(u + p).then((r) => r.json()).catch(() => none);
Promise.all([get("api/history", []), get("api/state", {})]).then(([h, s]) => {
  const n = Array.isArray(s?.nodes) ? s.nodes.length : 0, kept = Array.isArray(h) && h.length > 1 ? `as it was left, ${h.length} versions in History` : "new";
  const what = n ? `${n} ${n === 1 ? "box" : "boxes"}` : own ? "no boxes yet: it offers Draw this repo, a system map drawn from the code in this folder" : "no boxes yet";
  console.log(`map: ${u}, ${kept}, ${what}`);
});' "$U" "$OWN"

# 3. the map in Chrome: the tab already on it comes to the front, otherwise a new tab
how=$([ "${ANUR_LIVING_MAP_NO_BROWSER:-}" = 1 ] && echo skipped || osascript - "$U" "$OPEN" 2>/dev/null <<'OSA'
on run {u, o}
  if application "Google Chrome" is not running then return "none"
  tell application "Google Chrome"
    repeat with w in windows
      set i to 0
      repeat with t in tabs of w
        set i to i + 1
        if URL of t starts with u then
          if o is not u then set URL of t to o
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
if [ "$how" = skipped ]; then echo "chrome: skipped, would open $OPEN"
elif [ "$how" = front ]; then echo "chrome: already open on the map, brought to the front"
else open -a "Google Chrome" "$OPEN" && echo "chrome: opened $OPEN"; fi

# 4. this chat linked to the map, so the map's Claude pane shows it and what is typed there comes here. A Pi chat
#    names its own transcript; a Claude Code chat's is found by its id.
if [ -n "$SID" ]; then
  if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then F=$(ls ~/.claude/projects/*/"$SID".jsonl 2>/dev/null | head -1); else F="${PI_SESSION_FILE:-}"; fi
  curl -s -X POST "${U}api/act" -H 'content-type: application/json' \
    --data "{\"type\":\"link\",\"by\":\"${LIVING_MAP_ME:-$(id -F 2>/dev/null | cut -d' ' -f1)}\",\"session\":\"$SID\",\"file\":\"$F\"}" >/dev/null
  echo "chat: linked to the map"
else echo "chat: not linked (no session id)"; fi

# 4b. a Pi chat reaches the map through its MCP server and hears it through the listener extension; each is added
#     once, pointing at the clone so it follows its updates. Pi reads both when a chat starts or after /reload.
if [ -n "${PI_SESSION_ID:-}" ] && [ -z "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  PA="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"; added=""
  if ! grep -qE '"(anur-)?living-map"' "$PA/mcp.json" 2>/dev/null; then
    # its tools are declared to the model like built-in ones, so the chat calls living_map_change directly
    pi mcp add anur-living-map -- node "$H/team/live/mcp.js" >/dev/null 2>&1 && node -e '
      const f = process.argv[1], c = JSON.parse(require("fs").readFileSync(f, "utf8"));
      c.mcpServers["anur-living-map"].exposure = "direct"; require("fs").writeFileSync(f, JSON.stringify(c, null, 2) + "\n");' "$PA/mcp.json" \
      && added="the map's tools" || echo "pi: could not add the map's tools (pi mcp add anur-living-map -- node $H/team/live/mcp.js)"
  fi
  X="$PA/extensions/anur-living-map.js"; line="export { default } from \"$H/team/live/agents/pi/listener.js\";"
  if [ "$(cat "$X" 2>/dev/null)" != "$line" ]; then
    mkdir -p "$PA/extensions" && printf '%s\n' "$line" > "$X" && added="${added:+$added and }the listener"
  fi
  if [ -n "$added" ]; then echo "pi: added $added; type /reload once so this chat has them"
  else echo "pi: map tools and listener already set up"; fi
fi

# 5. the rules this chat follows on this map, from the server itself, so they match what it can do
echo "RULES FROM THE MAP:"; curl -s "${U}api/rules?session=$SID"
