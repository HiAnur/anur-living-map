import AVFoundation
import Foundation

/// Your voice: the default input device through an AVAudioEngine input tap.
final class MicCapture {
  private let engine = AVAudioEngine()

  /// Asks for microphone access the first time; true when it is granted.
  static func requestAccess() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return true
    case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
    default: return false
    }
  }

  func start(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw TranscriberError.unavailable("no microphone input")
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in onBuffer(buffer) }
    engine.prepare()
    try engine.start()
  }

  func stop() {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
  }
}
