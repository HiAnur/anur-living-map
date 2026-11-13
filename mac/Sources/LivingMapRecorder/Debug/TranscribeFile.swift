import AVFoundation
import Foundation
import RecorderCore

/// `--transcribe-file <audio> [--speaker you|others] [--engine auto|analyzer|legacy] [--locale en-US] [--realtime]`
///
/// Feeds a file through the same transcriber the recorder uses live, in small
/// buffers, and prints each finalized segment as one JSON line on stdout.
enum TranscribeFile {
  static func run(_ args: [String]) async -> Int32 {
    guard let path = value(after: "--transcribe-file", in: args) else {
      log("usage: LivingMapRecorder --transcribe-file <audio> [--speaker you|others] [--engine auto|analyzer|legacy] [--locale id] [--realtime]")
      return 64
    }
    let speaker = Speaker(rawValue: value(after: "--speaker", in: args) ?? "you") ?? .you
    let engine = TranscriberEngine(rawValue: value(after: "--engine", in: args) ?? "auto") ?? .auto
    let locale = value(after: "--locale", in: args).map(Locale.init(identifier:)) ?? .current
    let realtime = args.contains("--realtime")

    let file: AVAudioFile
    do {
      file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    } catch {
      log("cannot read \(path): \(error.localizedDescription)")
      return 66
    }
    let transcriber = await Transcribers.make(engine: engine, locale: locale)
    let origin = Date()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let printed = Counter()
    log("engine \(transcriber.engineName), \(file.processingFormat.sampleRate) Hz, \(file.length) frames")

    do {
      try await transcriber.start { heard in
        let segment = Segment(text: heard.text, speaker: speaker, origin: origin, startSeconds: heard.start, endSeconds: heard.end)
        if let line = try? encoder.encode(segment), let text = String(data: line, encoding: .utf8) {
          print(text)
          fflush(stdout)
          printed.add()
        }
      }
    } catch {
      log("transcriber did not start: \(error.localizedDescription)")
      return 69
    }

    let chunk: AVAudioFrameCount = 1600
    // The legacy recognizer cuts requests at pauses it notices in wall-clock
    // time, so it is fed in real time; SpeechAnalyzer can take the file at once.
    let pace = realtime || transcriber is LegacyTranscriber
    while file.framePosition < file.length {
      guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk) else { break }
      do { try file.read(into: buffer, frameCount: chunk) } catch {
        log("read failed: \(error.localizedDescription)")
        break
      }
      if buffer.frameLength == 0 { break }
      transcriber.append(buffer)
      if pace { try? await Task.sleep(for: .seconds(Double(buffer.frameLength) / file.processingFormat.sampleRate)) }
    }
    await transcriber.finish()
    log("\(printed.value) segment(s)")
    return printed.value > 0 ? 0 : 1
  }

  static func value(after flag: String, in args: [String]) -> String? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return args[i + 1]
  }
}

final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  func add() { lock.withLock { count += 1 } }
  var value: Int { lock.withLock { count } }
}
