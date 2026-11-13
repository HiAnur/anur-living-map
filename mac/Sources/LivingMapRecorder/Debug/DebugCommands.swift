import AVFoundation
import Foundation
import RecorderCore

/// Headless checks of the parts that need the real Mac.
enum DebugCommands {
  /// `--meeting-signal`: prints what the meeting detector sees right now, as JSON.
  static func meetingSignal(_ args: [String]) async -> Int32 {
    let signal = CA.meetingSignal()
    let users = (signal.processes ?? []).filter { $0.runningInput && $0.pid != getpid() }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    struct Report: Encodable {
      var signal: MeetingSignal
      var inputUsers: [String]
      var app: String?
    }
    let report = Report(
      signal: signal, inputUsers: users.map { $0.bundleID ?? "pid \($0.pid)" },
      app: MeetingApps.pick(users.compactMap(\.bundleID)))
    if let data = try? encoder.encode(report) { print(String(decoding: data, as: UTF8.self)) }
    return 0
  }

  /// `--tap-test [seconds] [--transcribe] [--mute]`: captures the Mac's sound
  /// for a few seconds and reports whether frames and non-silent audio arrived;
  /// `--transcribe` also prints what it heard, `--mute` keeps it off the speakers.
  static func tapTest(_ args: [String]) async -> Int32 {
    guard #available(macOS 14.2, *) else {
      log("system audio taps need macOS 14.2")
      return 69
    }
    let seconds = TranscribeFile.value(after: "--tap-test", in: args).flatMap(Double.init) ?? 5
    let capture = SystemAudioCapture()
    var transcriber: LiveTranscriber?
    if args.contains("--transcribe") {
      let made = await Transcribers.make()
      do {
        try await made.start { heard in print("others: \(heard.text)") }
        transcriber = made
      } catch {
        log("transcriber did not start: \(error.localizedDescription)")
      }
    }
    let feed = transcriber
    do {
      try capture.start(muted: args.contains("--mute")) { feed?.append($0) }
    } catch {
      log("tap failed: \(error.localizedDescription)")
      return 1
    }
    try? await Task.sleep(for: .seconds(seconds))
    capture.stop()
    await transcriber?.finish()
    print("frames=\(capture.frames) heardSound=\(capture.heardSound)")
    return capture.frames > 0 ? 0 : 1
  }
}
