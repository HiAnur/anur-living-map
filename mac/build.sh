#!/bin/bash
# Builds "build/Living Map Recorder.app": a release build of the Swift package,
# wrapped in a bundle with its Info.plist, signed ad hoc for this Mac.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release --product LivingMapRecorder
BIN="$(swift build -c release --show-bin-path)/LivingMapRecorder"

APP="build/Living Map Recorder.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/LivingMapRecorder"
cp Resources/Info.plist "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# The Anur mark, from the brand files as they are; the generated images live
# only in the bundle.
BRAND=../docs/brand
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
size() { sips -z "$2" "$2" "$1" --out "$3" >/dev/null; }

# App icon: every size iconutil wants, from the 1024 px mark.
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for px in 16 32 128 256 512; do
  size "$BRAND/hianur-mark-1024.png" "$px" "$ICONSET/icon_${px}x${px}.png"
  size "$BRAND/hianur-mark-1024.png" "$((px * 2))" "$ICONSET/icon_${px}x${px}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Menu bar: the dark diamond alone, 18 pt, drawn as a template by the app.
size "$BRAND/hianur-diamond-dark-1024.png" 18 "$APP/Contents/Resources/MenuBarIcon.png"
size "$BRAND/hianur-diamond-dark-1024.png" 36 "$APP/Contents/Resources/MenuBarIcon@2x.png"

# The whole mark, for the meeting prompt and the import window.
size "$BRAND/hianur-mark-1024.png" 32 "$APP/Contents/Resources/Mark.png"
size "$BRAND/hianur-mark-1024.png" 64 "$APP/Contents/Resources/Mark@2x.png"

# Ad hoc, with the hardened runtime and the audio-input entitlement. An ad hoc
# signature changes with every build, so macOS may ask for permissions again.
codesign --force --sign - --options runtime \
  --entitlements Resources/LivingMapRecorder.entitlements "$APP"
codesign --verify --strict "$APP"

echo "Built $(pwd)/$APP"
