import CoreAudio
import Foundation
import RecorderCore

/// Small typed reads of CoreAudio object properties.
enum CA {
  static func address(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal)
    -> AudioObjectPropertyAddress
  {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
  }

  static func read<T: BitwiseCopyable>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, as: T.Type, default value: T) -> T? {
    var address = address(selector)
    var result = value
    var size = UInt32(MemoryLayout<T>.size)
    let status = AudioObjectGetPropertyData(object, &address, 0, nil, &size, &result)
    return status == noErr ? result : nil
  }

  static func readArray(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID]? {
    var address = address(selector)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr else { return nil }
    var items = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &items) == noErr else { return nil }
    return items
  }

  static func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var address = address(selector)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr, let value else { return nil }
    return value.takeRetainedValue() as String
  }

  static var defaultInputDevice: AudioObjectID? {
    read(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultInputDevice, as: AudioObjectID.self, default: 0)
      .flatMap { $0 == kAudioObjectUnknown ? nil : $0 }
  }

  static var defaultOutputDevice: AudioObjectID? {
    read(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, as: AudioObjectID.self, default: 0)
      .flatMap { $0 == kAudioObjectUnknown ? nil : $0 }
  }

  /// The CoreAudio process object for a pid (macOS 14.2+).
  static func processObject(pid: pid_t) -> AudioObjectID? {
    var address = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
    var pid = pid
    var object = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
    return status == noErr && object != kAudioObjectUnknown ? object : nil
  }

  /// One look at the microphone, for the meeting policy.
  static func meetingSignal() -> MeetingSignal {
    var running = false
    if let input = defaultInputDevice,
      let flag = read(input, kAudioDevicePropertyDeviceIsRunningSomewhere, as: UInt32.self, default: 0)
    {
      running = flag != 0
    }
    var processes: [AudioProcess]?
    if #available(macOS 14.2, *), let objects = readArray(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) {
      processes = objects.compactMap { object in
        guard let pid = read(object, kAudioProcessPropertyPID, as: pid_t.self, default: -1) else { return nil }
        let input = read(object, kAudioProcessPropertyIsRunningInput, as: UInt32.self, default: 0) ?? 0
        return AudioProcess(pid: pid, bundleID: readString(object, kAudioProcessPropertyBundleID), runningInput: input != 0)
      }
    }
    return MeetingSignal(inputRunningSomewhere: running, processes: processes)
  }
}
