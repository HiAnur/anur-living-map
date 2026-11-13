import AVFoundation
import Foundation
import Speech

/// SFSpeechRecognizer with on-device recognition only, for Macs without
/// SpeechAnalyzer. A request is limited to about a minute of audio, so each one
/// ends at a pause in speech or after `maxRequest` seconds of audio and a new
/// one takes over; only each request's final result is reported.
final class LegacyTranscriber: LiveTranscriber, @unchecked Sendable {
  let engineName = "SFSpeechRecognizer"
  private let locale: Locale
  private let maxRequest: Double = 45
  private let pause: TimeInterval = 1.2
  private let queue = DispatchQueue(label: "recorder.legacy.append")
  private let pending = DispatchGroup()
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var onText: (@Sendable (HeardText) -> Void)?
  /// Seconds of audio fed so far, and where the current request began in it.
  private var fed: Double = 0
  private var requestStart: Double = 0
  private var lastPartialAt: Date?
  private var heardSomething = false
  private var finished = false

  init(locale: Locale) { self.locale = locale }

  func start(onText: @escaping @Sendable (HeardText) -> Void) async throws {
    guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")) else {
      throw TranscriberError.unavailable("no recognizer for \(locale.identifier)")
    }
    guard recognizer.supportsOnDeviceRecognition else {
      throw TranscriberError.unavailable("\(recognizer.locale.identifier) cannot be recognized on this Mac")
    }
    if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
      await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
        SFSpeechRecognizer.requestAuthorization { _ in done.resume() }
      }
    }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else { throw TranscriberError.notAuthorized }
    // Results come on this queue, not the main one, so a headless run needs no run loop.
    let results = OperationQueue()
    results.maxConcurrentOperationCount = 1
    recognizer.queue = results
    queue.sync {
      self.recognizer = recognizer
      self.onText = onText
      self.beginRequest()
    }
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    guard let copy = copyBuffer(buffer) else { return }
    queue.async {
      guard !self.finished, let request = self.request else { return }
      request.append(copy)
      self.fed += Double(copy.frameLength) / copy.format.sampleRate
      let length = self.fed - self.requestStart
      let paused = self.heardSomething && Date().timeIntervalSince(self.lastPartialAt ?? .distantPast) > self.pause
      if length >= self.maxRequest || (paused && length > 2) { self.rotate() }
    }
  }

  func finish() async {
    queue.sync {
      self.finished = true
      self.request?.endAudio()
      self.request = nil
    }
    // A final result can take a moment after endAudio; do not wait forever.
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      DispatchQueue.global().async {
        _ = self.pending.wait(timeout: .now() + 15)
        done.resume()
      }
    }
  }

  // Runs on `queue`.
  private func rotate() {
    request?.endAudio()
    beginRequest()
  }

  // Runs on `queue`.
  private func beginRequest() {
    guard let recognizer else { return }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    request.taskHint = .dictation
    let offset = fed
    requestStart = fed
    lastPartialAt = nil
    heardSomething = false
    self.request = request
    pending.enter()
    var done = false
    recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result, !result.isFinal {
        self.queue.async {
          if self.request === request {
            self.heardSomething = !result.bestTranscription.formattedString.isEmpty
            self.lastPartialAt = Date()
          }
        }
      }
      if let result, result.isFinal {
        let transcription = result.bestTranscription
        let text = transcription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
          let first = transcription.segments.first
          let last = transcription.segments.last
          let start = offset + (first?.timestamp ?? 0)
          let end = offset + ((last?.timestamp ?? 0) + (last?.duration ?? 0))
          self.onText?(HeardText(text: text, start: start, end: max(end, start)))
        }
      }
      if (result?.isFinal ?? false) || error != nil, !done {
        done = true
        self.pending.leave()
      }
    }
  }
}
