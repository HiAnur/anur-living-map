#!/usr/bin/env bash
# A preview of one branch's team map, on a port of its own, so several branches can be tried at once in their own
# browser tabs while the map you use every day stays on 4323. Run from inside a worktree (or name one):
#
#   team/live/preview.sh [start] [worktree]   start, or restart on new code, and print the link
#   team/live/preview.sh stop [worktree]      stop it and delete its copy of the maps
#   team/live/preview.sh list                 every preview running, with its branch
#
# The link names the branch (http://<branch>.localhost:<port>). A worktree keeps its port in .preview/port, so
# restarts keep the same link. The first start copies your maps
# into .preview/data (an APFS clone: instant, no extra space until something changes), so what you click in a
# preview never reaches your real maps; it goes when the preview stops or the worktree is removed. The copy leaves
# out cloud.json and mail.json, so a preview can neither publish a map nor send mail. A preview never updates
# itself. Every run first stops previews whose worktree folder no longer exists.
set -u

FIRST=4401 LAST=4499
DAILY=4323
action=start
case "${1:-}" in start | stop | list) action=$1; shift ;; esac

# the map data this Mac uses, as team/live/data-dir.js finds it
DATA=${ANUR_LIVING_MAP_DATA:-$HOME/.anur-living-map}
[ -z "${ANUR_LIVING_MAP_DATA:-}" ] && [ ! -d "$HOME/.anur-living-map" ] && [ -d "$HOME/.living-map-2" ] && DATA=$HOME/.living-map-2

# the link to a preview: its branch as a name under .localhost, which browsers send to this Mac, so the address bar
# says which branch a tab shows (codex/fix-x on 4402 is http://codex-fix-x.localhost:4402)
link() { local n; n=$(printf %s "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//' | cut -c1-50 | sed 's/-$//'); echo "http://${n:-preview}.localhost:$2"; }
# the folder a preview server on `port` was started from, or nothing
served_from() { ps -o command= -p "$(lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1)" 2>/dev/null | sed -n 's#^[^ ]*node \(.*\)/team/live/server\.js .*#\1#p'; }
listening() { lsof -nP -t -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
preview_port() { [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$1" -ge "$FIRST" ] && [ "$1" -le "$LAST" ]; }

# stop previews whose worktree is gone (a session that ended, a folder deleted by hand)
for port in $(seq "$FIRST" "$LAST"); do
  listening "$port" || continue
  from=$(served_from "$port")
  if [ -n "$from" ] && [ ! -d "$from" ]; then
    kill "$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN)" 2>/dev/null && echo "preview: stopped $port, its worktree $from is gone"
  fi
done

if [ "$action" = list ]; then
  found=0
  for port in $(seq "$FIRST" "$LAST"); do
    from=$(served_from "$port"); [ -n "$from" ] || continue
    b=$(git -C "$from" branch --show-current 2>/dev/null | grep . || git -C "$from" rev-parse --short HEAD 2>/dev/null)
    found=1; echo "$(link "$b" "$port")  $from"
  done
  [ "$found" = 1 ] || echo "preview: none running"
  exit 0
fi

WT=$(cd "${1:-.}" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || { echo "preview: not inside a git worktree"; exit 1; }
P="$WT/.preview"
branch() { git -C "$1" branch --show-current 2>/dev/null | grep . || git -C "$1" rev-parse --short HEAD 2>/dev/null || echo '?'; }
stop_own() {
  local port; port=$(cat "$P/port" 2>/dev/null) || return 0
  # A saved port is not permission to stop an everyday or installed test copy.
  preview_port "$port" || return 0
  [ "$(served_from "$port")" = "$WT" ] && kill "$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN)" 2>/dev/null
  for _ in $(seq 50); do listening "$port" || break; sleep 0.1; done
}

if [ "$action" = stop ]; then
  stop_own; rm -rf "$P"; echo "preview: stopped, $WT has no preview now"; exit 0
fi

# its port: the one it kept, unless something else took it; else the first one free and kept by no other worktree
port=$(cat "$P/port" 2>/dev/null || true)
# Old or hand-written settings must not turn a reserved port into a preview.
preview_port "$port" || port=""
if [ -n "$port" ] && listening "$port" && [ "$(served_from "$port")" != "$WT" ]; then port=""; fi
if [ -z "$port" ]; then
  kept=$(git -C "$WT" worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do [ "$w" != "$WT" ] && cat "$w/.preview/port" 2>/dev/null; done)
  for p in $(seq "$FIRST" "$LAST"); do
    listening "$p" && continue
    printf '%s\n' "$kept" | grep -qx "$p" && continue
    port=$p; break
  done
  [ -n "$port" ] || { echo "preview: no free port between $FIRST and $LAST"; exit 1; }
fi
[ "$port" = "$DAILY" ] && { echo "preview: $DAILY is your everyday map, never a preview"; exit 1; }

mkdir -p "$P"; echo "$port" > "$P/port"
if [ ! -d "$P/data" ]; then
  mkdir -p "$P/data"
  for f in "$DATA"/* "$DATA"/.[!.]*; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in cloud.json | mail.json | server.rev | server-*.log | channel) continue ;; esac
    cp -Rc "$f" "$P/data/" 2>/dev/null || cp -R "$f" "$P/data/"
  done
  echo "preview: copied your maps into $P/data"
fi

# the code folder the everyday map is opened on, so the preview opens the same one
project=$(ps -o command= -p "$(lsof -nP -t -iTCP:$DAILY -sTCP:LISTEN 2>/dev/null | head -1)" 2>/dev/null | sed -n 's/.* --project \(.*\)$/\1/p')

stop_own
(
  cd "${project:-$WT}" || exit 1
  ANUR_LIVING_MAP_DATA="$P/data" ANUR_LIVING_MAP_NO_UPDATE=1 nohup node "$WT/team/live/server.js" "$port" ${project:+--project "$project"} >> "$P/server.log" 2>&1 &
)
for _ in $(seq 100); do curl -sf "localhost:$port/api/version" >/dev/null && break; sleep 0.1; done
curl -sf "localhost:$port/api/version" >/dev/null || { echo "preview: the server did not start; last lines of $P/server.log:"; tail -5 "$P/server.log"; exit 1; }
echo "preview: $(link "$(branch "$WT")" "$port")"
