import AVFoundation
import Foundation

/// Text a transcriber finalized, timed in seconds from the start of its audio.
struct HeardText: Sendable {
  var text: String
  var start: Double
  var end: Double
}

/// One on-device transcriber for one audio source. `append` may be called from
/// any thread (an audio tap, a CoreAudio IO proc); results arrive on another.
protocol LiveTranscriber: AnyObject {
  var engineName: String { get }
  func start(onText: @escaping @Sendable (HeardText) -> Void) async throws
  func append(_ buffer: AVAudioPCMBuffer)
  /// Ends the audio and waits for the last results.
  func finish() async
}

enum TranscriberEngine: String {
  case auto, analyzer, legacy
}

enum TranscriberError: LocalizedError {
  case unavailable(String)
  case notAuthorized
  case conversion(String)

  var errorDescription: String? {
    switch self {
    case .unavailable(let why): return "On-device transcription is not available: \(why)"
    case .notAuthorized: return "Speech recognition is not allowed for this app (System Settings > Privacy & Security > Speech Recognition)"
    case .conversion(let why): return "Audio could not be converted for transcription: \(why)"
    }
  }
}

enum Transcribers {
  /// SpeechAnalyzer on macOS 26+ when it has the locale, else SFSpeechRecognizer on device.
  static func make(engine: TranscriberEngine = .auto, locale: Locale = .current) async -> LiveTranscriber {
    if engine != .legacy, #available(macOS 26, *) {
      let supported = await AnalyzerTranscriber.isSupported(locale: locale)
      if engine == .analyzer || supported {
        return AnalyzerTranscriber(locale: locale)
      }
    }
    return LegacyTranscriber(locale: locale)
  }
}

/// Copies a buffer, so audio a caller reuses can be converted later on another queue.
func copyBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
  guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: max(buffer.frameLength, 1)) else {
    return nil
  }
  copy.frameLength = buffer.frameLength
  let src = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
  let dst = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
  for (from, to) in zip(src, dst) {
    guard let source = from.mData, let target = to.mData else { continue }
    memcpy(target, source, Int(min(from.mDataByteSize, to.mDataByteSize)))
  }
  return copy
}

/// Streams buffers of any format into one target format, keeping the
/// converter's state between buffers so resampling has no seams.
final class BufferConverter {
  private var converter: AVAudioConverter?

  func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
    if buffer.format == format { return buffer }
    if converter == nil || converter!.inputFormat != buffer.format || converter!.outputFormat != format {
      guard let made = AVAudioConverter(from: buffer.format, to: format) else {
        throw TranscriberError.conversion("\(buffer.format) to \(format)")
      }
      made.downmix = true
      made.primeMethod = .none
      converter = made
    }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
      throw TranscriberError.conversion("no output buffer")
    }
    var fed = false
    var error: NSError?
    let status = converter!.convert(to: out, error: &error) { _, inputStatus in
      if fed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      fed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status == .error { throw TranscriberError.conversion(error?.localizedDescription ?? "unknown") }
    return out
  }
}
