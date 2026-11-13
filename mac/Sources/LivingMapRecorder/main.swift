import AppKit
import Foundation

let arguments = CommandLine.arguments

/// Runs one headless debug command and exits with its status.
func runHeadless(_ body: @escaping () async -> Int32) -> Never {
  Task {
    let code = await body()
    exit(code)
  }
  dispatchMain()
}

if arguments.contains("--transcribe-file") {
  runHeadless { await TranscribeFile.run(arguments) }
} else if arguments.contains("--meeting-signal") {
  runHeadless { await DebugCommands.meetingSignal(arguments) }
} else if arguments.contains("--tap-test") {
  runHeadless { await DebugCommands.tapTest(arguments) }
} else {
  MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
    _ = delegate
  }
}
