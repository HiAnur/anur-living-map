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

# Ad hoc, with the hardened runtime and the audio-input entitlement. An ad hoc
# signature changes with every build, so macOS may ask for permissions again.
codesign --force --sign - --options runtime \
  --entitlements Resources/LivingMapRecorder.entitlements "$APP"
codesign --verify --strict "$APP"

echo "Built $(pwd)/$APP"
