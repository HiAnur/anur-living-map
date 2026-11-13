import AVFoundation
import CoreMedia
import Foundation
import Speech

/// SpeechAnalyzer + SpeechTranscriber (macOS 26+): on device, long-form, final
/// results only. Downloads the locale's model through AssetInventory if needed.
@available(macOS 26, *)
final class AnalyzerTranscriber: LiveTranscriber, @unchecked Sendable {
  let engineName = "SpeechAnalyzer"
  private let requestedLocale: Locale
  private let queue = DispatchQueue(label: "recorder.analyzer.append")
  private let converter = BufferConverter()
  private var format: AVAudioFormat?
  private var input: AsyncStream<AnalyzerInput>.Continuation?
  private var analyzer: SpeechAnalyzer?
  private var results: Task<Void, Never>?
  private var failedConversions = 0

  init(locale: Locale) { requestedLocale = locale }

  static func isSupported(locale: Locale) async -> Bool {
    guard SpeechTranscriber.isAvailable else { return false }
    return await SpeechTranscriber.supportedLocale(equivalentTo: locale) != nil
  }

  func start(onText: @escaping @Sendable (HeardText) -> Void) async throws {
    guard SpeechTranscriber.isAvailable else { throw TranscriberError.unavailable("SpeechTranscriber is not available on this Mac") }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
      throw TranscriberError.unavailable("no model for \(requestedLocale.identifier)")
    }
    let transcriber = SpeechTranscriber(
      locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    try await Self.ensureAssets(for: transcriber, locale: locale)

    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
      throw TranscriberError.unavailable("no audio format for the transcriber")
    }
    let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.prepareToAnalyze(in: format)

    results = Task.detached {
      do {
        for try await result in transcriber.results where result.isFinal {
          let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
          guard !text.isEmpty else { continue }
          let start = result.range.start.seconds
          let end = CMTimeRangeGetEnd(result.range).seconds
          onText(HeardText(text: text, start: start.isFinite ? start : 0, end: end.isFinite ? end : start))
        }
      } catch {
        log("transcriber results ended: \(error.localizedDescription)")
      }
    }
    queue.sync {
      self.format = format
      self.input = continuation
    }
    self.analyzer = analyzer
    try await analyzer.start(inputSequence: stream)
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    guard let copy = copyBuffer(buffer) else { return }
    queue.async {
      guard let format = self.format, let input = self.input else { return }
      do {
        let converted = try self.converter.convert(copy, to: format)
        if converted.frameLength > 0 { input.yield(AnalyzerInput(buffer: converted)) }
      } catch {
        self.failedConversions += 1
        if self.failedConversions == 1 { log(error.localizedDescription) }
      }
    }
  }

  func finish() async {
    let input = queue.sync { () -> AsyncStream<AnalyzerInput>.Continuation? in
      let input = self.input
      self.input = nil
      return input
    }
    input?.finish()
    do {
      try await analyzer?.finalizeAndFinishThroughEndOfInput()
    } catch {
      log("finishing the analyzer: \(error.localizedDescription)")
    }
    await results?.value
  }

  /// Installs the locale's model when it is missing; a no-op once it is there.
  static func ensureAssets(for transcriber: SpeechTranscriber, locale: Locale) async throws {
    let status = await AssetInventory.status(forModules: [transcriber])
    if status == .installed { return }
    guard status != .unsupported else { throw TranscriberError.unavailable("\(locale.identifier) is not supported") }
    _ = try? await AssetInventory.reserve(locale: locale)
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      log("downloading the speech model for \(locale.identifier)…")
      try await request.downloadAndInstall()
      log("speech model installed")
    }
  }
}
