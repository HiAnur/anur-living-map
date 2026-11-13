# Living Map Recorder (macOS prototype)

A menu-bar app that notices when you join a meeting and offers **Start Living Map Recorder**. While it records, it transcribes on this Mac (your microphone as `you`, the Mac's sound as `others`) and streams each finished sentence to Anur Living Map, the team map server on this Mac. Each meeting becomes its own map, drawn live, which the app shows in its own window.

Needs macOS 14.2 or newer; on-device transcription uses SpeechAnalyzer on macOS 26+, else SFSpeechRecognizer.

## Build and run

```bash
cd mac
swift test        # the logic: API client, segment queue, meeting detection, settings
./build.sh        # builds "build/Living Map Recorder.app", signed ad hoc, with the Anur icons
open "build/Living Map Recorder.app"
```

`build.sh` makes the app icon, the menu-bar diamond and the mark in the meeting prompt from the brand files in `docs/brand/`, unchanged; the generated images live only in the bundle.

The menu: Start or Stop recording (with the elapsed time), Open map (before your first meeting, Open Living Map: the list of every map), Import transcript… (paste, or a .txt/.md/.vtt/.srt file), Recent meetings, the server's status, Quit. Logs: `log stream --predicate 'subsystem == "com.anur.living-map-recorder"'`.

Headless checks, from `mac/` after `swift build`:

```bash
say -o /tmp/hi.wav --data-format=LEI16@16000 "We ship on Friday."
.build/debug/LivingMapRecorder --transcribe-file /tmp/hi.wav [--speaker you|others] [--engine auto|analyzer|legacy] [--realtime]
.build/debug/LivingMapRecorder --meeting-signal              # which apps hold the mic now
.build/debug/LivingMapRecorder --tap-test 10 --transcribe    # the Mac's sound for 10 s
```

`--transcribe-file` prints one JSON segment per line. With SpeechAnalyzer it needs no permission. The SFSpeechRecognizer engine and `--tap-test` need permissions macOS gives an app, so run them through the bundle: `open -W --stdout out.txt "build/Living Map Recorder.app" --args --tap-test 10`.

## Who is recording

Each meeting is sent with `by`, the person recording, and the map's chat pane is shown only to that person. So `by` must be your team sign-in name on Anur Living Map. It is the first word of your Mac account's full name unless you set it:

```bash
defaults write com.anur.living-map-recorder yourName Harshit
```

The menu shows the name it records as. An imported transcript also sends your full name, so lines under that name are filed as yours.

## Permissions it asks for

- **Microphone**, when recording starts.
- **System Audio Recording**, the first time it listens to the Mac's sound. Refused, it keeps recording your microphone, and the menu says it hears no sound from others.
- **Speech Recognition**, only for the SFSpeechRecognizer fallback (macOS before 26).

An ad hoc signature changes with every build, so macOS may ask again after a rebuild.

## How it finds Anur Living Map

- Address: `LIVING_MAP_URL`, else `defaults write com.anur.living-map-recorder serverURL http://localhost:4323`, else `http://localhost:4323`. It is up when `GET /api/version` answers.
- No token: the server trusts a program on this Mac whose requests carry no cookie, so the recorder never sends one.
- The recorder does not start the server. When it is not running, the menu says so; open it with `/anur-living-map` in Claude Code.
- The map window opens `http://localhost:4323/<map>/`. The first time it goes through the team sign-in, and the window remembers it.

An app opened from Finder or `open` does not see your shell's variables; pass them with `open --env LIVING_MAP_URL=… "build/Living Map Recorder.app"`, or use the settings.

Segments the server has not taken are kept on disk (`~/Library/Application Support/Living Map Recorder/pending/`) and sent, followed by the meeting's end, once it is back. A meeting the server refuses (it has ended, or its map is gone) is not retried.
