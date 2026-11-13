import AVFoundation
import CoreAudio
import Foundation

/// The Mac's sound, every process but this one, through a CoreAudio process
/// tap (macOS 14.2+) on a private aggregate device. The first start asks for
/// "System Audio Recording"; if that is refused the tap delivers silence, which
/// `heardSound` makes visible.
@available(macOS 14.2, *)
final class SystemAudioCapture: @unchecked Sendable {
  enum Failure: LocalizedError {
    case step(String, OSStatus)
    var errorDescription: String? {
      switch self {
      case .step(let what, let status): return "\(what) failed (\(status))"
      }
    }
  }

  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var aggregateID = AudioObjectID(kAudioObjectUnknown)
  private var procID: AudioDeviceIOProcID?
  private let queue = DispatchQueue(label: "recorder.system-audio", qos: .userInitiated)
  private let lock = NSLock()
  private var _heardSound = false
  private var starting = false
  private var stopAfterStart = false
  private var _frames: Int64 = 0

  /// True once any non-silent audio arrived (false after a refused permission).
  var heardSound: Bool { lock.withLock { _heardSound } }
  var frames: Int64 { lock.withLock { _frames } }

  /// `muted` silences what is tapped on the speakers while the tap runs (for
  /// the headless test, so it plays nothing aloud); recording leaves it audible.
  func start(muted: Bool = false, onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
    lock.withLock {
      starting = true
      stopAfterStart = false
    }
    defer {
      let stopNow = lock.withLock { () -> Bool in
        starting = false
        return stopAfterStart
      }
      if stopNow { tearDown() }
    }
    var exclude: [AudioObjectID] = []
    if let me = CA.processObject(pid: getpid()) { exclude.append(me) }
    let description = CATapDescription(stereoGlobalTapButExcludeProcesses: exclude)
    description.uuid = UUID()
    description.name = "Living Map Recorder"
    description.isPrivate = true
    description.muteBehavior = muted ? .muted : .unmuted

    var status = AudioHardwareCreateProcessTap(description, &tapID)
    guard status == noErr else { throw Failure.step("Creating the system audio tap", status) }

    guard var format = CA.read(tapID, kAudioTapPropertyFormat, as: AudioStreamBasicDescription.self, default: AudioStreamBasicDescription()),
      let avFormat = AVAudioFormat(streamDescription: &format)
    else {
      stop()
      throw Failure.step("Reading the tap's format", -1)
    }

    let outputUID = CA.defaultOutputDevice.flatMap { CA.readString($0, kAudioDevicePropertyDeviceUID) }
    var settings: [String: Any] = [
      kAudioAggregateDeviceNameKey: "Living Map Recorder Tap",
      kAudioAggregateDeviceUIDKey: "com.anur.living-map-recorder.tap.\(UUID().uuidString)",
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceTapListKey: [
        [kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]
      ],
    ]
    if let outputUID {
      settings[kAudioAggregateDeviceMainSubDeviceKey] = outputUID
      settings[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: outputUID]]
    }
    status = AudioHardwareCreateAggregateDevice(settings as CFDictionary, &aggregateID)
    guard status == noErr else {
      stop()
      throw Failure.step("Creating the aggregate device", status)
    }

    status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { [weak self] _, input, _, _, _ in
      guard let self,
        let buffer = AVAudioPCMBuffer(pcmFormat: avFormat, bufferListNoCopy: input, deallocator: nil),
        let copy = copyBuffer(buffer)
      else { return }
      self.note(copy)
      onBuffer(copy)
    }
    guard status == noErr else {
      stop()
      throw Failure.step("Creating the IO proc", status)
    }
    status = AudioDeviceStart(aggregateID, procID)
    guard status == noErr else {
      stop()
      throw Failure.step("Starting the aggregate device", status)
    }
  }

  /// Safe to call while `start` is still waiting on the permission prompt:
  /// then the capture is torn down as soon as `start` returns.
  func stop() {
    let deferred = lock.withLock { () -> Bool in
      if starting { stopAfterStart = true }
      return starting
    }
    if !deferred { tearDown() }
  }

  private func tearDown() {
    if aggregateID != kAudioObjectUnknown {
      if let procID {
        AudioDeviceStop(aggregateID, procID)
        AudioDeviceDestroyIOProcID(aggregateID, procID)
      }
      AudioHardwareDestroyAggregateDevice(aggregateID)
    }
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
    procID = nil
    aggregateID = AudioObjectID(kAudioObjectUnknown)
    tapID = AudioObjectID(kAudioObjectUnknown)
  }

  private func note(_ buffer: AVAudioPCMBuffer) {
    var loud = false
    if !heardSound, let channels = buffer.floatChannelData {
      let n = Int(buffer.frameLength)
      for c in 0..<Int(buffer.format.channelCount) where !loud {
        for i in 0..<n where abs(channels[c][i]) > 0.0005 {
          loud = true
          break
        }
      }
    }
    lock.withLock {
      _frames += Int64(buffer.frameLength)
      if loud { _heardSound = true }
    }
  }

  deinit { tearDown() }
}
