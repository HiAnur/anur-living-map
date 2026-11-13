# Living Map Recorder (macOS prototype)

A menu-bar app that notices when you join a meeting and offers **Start Living Map Recorder**. While it records, it transcribes on this Mac (your microphone as `you`, the Mac's sound as `others`), streams each finished sentence to the local Living Map server, and shows the meeting's live map in its own window.

Needs macOS 14.2 or newer; on-device transcription uses SpeechAnalyzer on macOS 26+, else SFSpeechRecognizer.

## Build and run

```bash
cd mac
swift test        # the logic: API client, segment queue, meeting detection, settings
./build.sh        # builds "build/Living Map Recorder.app", signed ad hoc
open "build/Living Map Recorder.app"
```

An imported transcript is sent with your Mac account's full name, so lines under that name are filed as yours.

The menu: Start or Stop recording (with the elapsed time), Open map, Import transcript… (paste, or a .txt/.md/.vtt/.srt file), Recent meetings, the server's status, Quit. Logs: `log stream --predicate 'subsystem == "com.anur.living-map-recorder"'`.

Headless checks, from `mac/` after `swift build`:

```bash
say -o /tmp/hi.wav --data-format=LEI16@16000 "We ship on Friday."
.build/debug/LivingMapRecorder --transcribe-file /tmp/hi.wav [--speaker you|others] [--engine auto|analyzer|legacy] [--realtime]
.build/debug/LivingMapRecorder --meeting-signal              # which apps hold the mic now
.build/debug/LivingMapRecorder --tap-test 10 --transcribe    # the Mac's sound for 10 s
```

`--transcribe-file` prints one JSON segment per line. With SpeechAnalyzer it needs no permission. The SFSpeechRecognizer engine and `--tap-test` need permissions macOS gives an app, so run them through the bundle: `open -W --stdout out.txt "build/Living Map Recorder.app" --args --tap-test 10`.

## Permissions it asks for

- **Microphone**, when recording starts.
- **System Audio Recording**, the first time it listens to the Mac's sound. Refused, it keeps recording your microphone, and the menu says it hears no sound from others.
- **Speech Recognition**, only for the SFSpeechRecognizer fallback (macOS before 26).

An ad hoc signature changes with every build, so macOS may ask again after a rebuild.

## How it finds the server

- Address: `LIVING_MAP_URL`, else `defaults write com.anur.living-map-recorder serverURL http://localhost:4317`, else `http://localhost:4317`.
- Token: `$LIVING_MAP_HOME/token`, else `~/.living-map/token`, read on every request.
- When the server is down it can start it with `node <folder>/skill/start.ts`. The folder comes from `LIVING_MAP_APP_DIR`, else the `appDir` setting (the menu's **Choose Living Map folder…**), else `~/workspace/anur-living-map` or `~/workspace/living-map` if it holds `skill/start.ts`. Otherwise the menu shows the command to run.

An app opened from Finder or `open` does not see your shell's variables; pass them with `open --env LIVING_MAP_URL=… "build/Living Map Recorder.app"`, or use the settings.

Segments the server has not taken are kept on disk (`~/Library/Application Support/Living Map Recorder/pending/`) and sent, followed by the meeting's end, once it is back.
