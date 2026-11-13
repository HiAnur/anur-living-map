import Foundation

/// A process CoreAudio says is using an input device.
public struct AudioProcess: Equatable, Sendable, Codable {
  public var pid: Int32
  public var bundleID: String?
  public var runningInput: Bool

  public init(pid: Int32, bundleID: String?, runningInput: Bool) {
    self.pid = pid
    self.bundleID = bundleID
    self.runningInput = runningInput
  }
}

/// One look at the microphone: is the default input running anywhere, and,
/// where macOS can say (14.2+), which processes are taking input.
public struct MeetingSignal: Equatable, Sendable, Codable {
  public var inputRunningSomewhere: Bool
  /// nil when the process list is not available; then only `inputRunningSomewhere` counts.
  public var processes: [AudioProcess]?

  public init(inputRunningSomewhere: Bool, processes: [AudioProcess]?) {
    self.inputRunningSomewhere = inputRunningSomewhere
    self.processes = processes
  }
}

/// Decides when to offer "Start Living Map Recorder": once when another app
/// has held the microphone for a few seconds and you are not recording, not
/// again until that meeting ends. Pure: the caller passes the signal and time.
public struct MeetingPolicy: Sendable {
  public enum Action: Equatable, Sendable {
    case none
    /// Show the prompt; `app` names the meeting app when it is known.
    case prompt(app: String?)
    /// The meeting ended while the prompt may still be up.
    case dismiss
  }

  public let ownPID: Int32
  /// How long another app must hold the mic before it counts as a meeting
  /// (dictation and Siri take it for a moment).
  public var confirmAfter: TimeInterval
  /// How long the mic must be free before a meeting counts as over.
  public var endAfter: TimeInterval

  private var activeSince: Date?
  private var idleSince: Date?
  private var armed = true
  private var prompted = false

  public init(ownPID: Int32, confirmAfter: TimeInterval = 5, endAfter: TimeInterval = 8) {
    self.ownPID = ownPID
    self.confirmAfter = confirmAfter
    self.endAfter = endAfter
  }

  /// True while a meeting is under way, as far as this policy can tell.
  public var inMeeting: Bool { activeSince != nil }

  public mutating func update(signal: MeetingSignal, isRecording: Bool, now: Date) -> Action {
    let users = Self.inputUsers(signal, ownPID: ownPID)
    let active = users != nil ? !users!.isEmpty : (signal.inputRunningSomewhere && !isRecording)

    if active {
      idleSince = nil
      if activeSince == nil { activeSince = now }
      if isRecording {
        // Recording through this meeting: stopping part-way does not mean "ask me again".
        armed = false
        return .none
      }
      if armed, now.timeIntervalSince(activeSince!) >= confirmAfter {
        armed = false
        prompted = true
        return .prompt(app: users.flatMap { MeetingApps.pick($0) })
      }
      return .none
    }

    guard activeSince != nil else { return .none }
    if idleSince == nil { idleSince = now }
    guard now.timeIntervalSince(idleSince!) >= endAfter else { return .none }
    activeSince = nil
    idleSince = nil
    armed = true
    if prompted {
      prompted = false
      return .dismiss
    }
    return .none
  }

  /// Bundle ids of other processes taking input, minus system speech services;
  /// nil when the signal has no process list.
  static func inputUsers(_ signal: MeetingSignal, ownPID: Int32) -> [String]? {
    guard let processes = signal.processes else { return nil }
    return processes.filter { $0.runningInput && $0.pid != ownPID }
      .map { $0.bundleID ?? "" }
      .filter { !MeetingApps.isIgnored($0) }
  }
}
