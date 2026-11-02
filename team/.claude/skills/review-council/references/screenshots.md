# Screenshots for the build gate

The demo pages open at any step through the URL hash, and `?rec` hides the demo controls. Headless Chrome renders each step at video size:

```bash
OUT=/path/to/scratchpad/shots; mkdir -p "$OUT"
for i in $(seq 0 9); do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1440,900 --force-device-scale-factor=1.5 --virtual-time-budget=3000 \
    --screenshot="$OUT/step-$i.png" "file://$PWD/plan-first.html?rec#$i"
done
```

Notes:
- Static renders show each step's end state. Anything that only flashes mid-animation (a notification, a hover) isn't in them. Give it its own step, or check it in a live browser.
- A background browser pane throttles timers. When testing animations there, wait longer, or check state through JavaScript rather than screenshots.
- Send reviewers the folder path and tell them to read every image.
