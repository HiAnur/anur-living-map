import Foundation
import Testing

@testable import RecorderCore

@Suite struct MeetingPolicyTests {
  let me: Int32 = 4242
  let t0 = Date(timeIntervalSince1970: 1_000_000)

  func at(_ seconds: Double) -> Date { t0.addingTimeInterval(seconds) }

  func zoom(_ on: Bool = true) -> MeetingSignal {
    MeetingSignal(
      inputRunningSomewhere: on,
      processes: [
        AudioProcess(pid: 100, bundleID: "us.zoom.xos", runningInput: on),
        AudioProcess(pid: 200, bundleID: "com.apple.Music", runningInput: false),
      ])
  }

  let quiet = MeetingSignal(inputRunningSomewhere: false, processes: [])

  func policy() -> MeetingPolicy { MeetingPolicy(ownPID: 4242, confirmAfter: 5, endAfter: 8) }

  @Test func promptsOnceWhenAMeetingHasHeldTheMic() {
    var p = policy()
    #expect(p.update(signal: zoom(), isRecording: false, now: at(0)) == .none)
    #expect(p.update(signal: zoom(), isRecording: false, now: at(3)) == .none)
    #expect(p.update(signal: zoom(), isRecording: false, now: at(6)) == .prompt(app: "Zoom"))
    #expect(p.update(signal: zoom(), isRecording: false, now: at(9)) == .none)
    #expect(p.update(signal: zoom(), isRecording: false, now: at(600)) == .none)
    #expect(p.inMeeting)
  }

  @Test func neverPromptsWhileRecording() {
    var p = policy()
    for s in stride(from: 0.0, through: 30, by: 3) {
      #expect(p.update(signal: zoom(), isRecording: true, now: at(s)) == .none)
    }
    // Stopping part-way through the same meeting does not ask again.
    #expect(p.update(signal: zoom(), isRecording: false, now: at(33)) == .none)
    #expect(p.update(signal: zoom(), isRecording: false, now: at(60)) == .none)
  }

  @Test func reArmsAfterTheMeetingEnds() {
    var p = policy()
    _ = p.update(signal: zoom(), isRecording: false, now: at(0))
    #expect(p.update(signal: zoom(), isRecording: false, now: at(6)) == .prompt(app: "Zoom"))
    // A short gap (a mic toggle) is not the end of the meeting.
    #expect(p.update(signal: quiet, isRecording: false, now: at(9)) == .none)
    #expect(p.update(signal: zoom(), isRecording: false, now: at(12)) == .none)
    // Free long enough: over, and the prompt goes away.
    #expect(p.update(signal: quiet, isRecording: false, now: at(15)) == .none)
    #expect(p.update(signal: quiet, isRecording: false, now: at(24)) == .dismiss)
    #expect(p.inMeeting == false)
    // The next meeting asks again.
    #expect(p.update(signal: zoom(), isRecording: false, now: at(100)) == .none)
    #expect(p.update(signal: zoom(), isRecording: false, now: at(106)) == .prompt(app: "Zoom"))
  }

  @Test func ignoresOurOwnProcess() {
    var p = policy()
    let onlyUs = MeetingSignal(
      inputRunningSomewhere: true,
      processes: [AudioProcess(pid: me, bundleID: "com.anur.living-map-recorder", runningInput: true)])
    for s in stride(from: 0.0, through: 30, by: 3) {
      #expect(p.update(signal: onlyUs, isRecording: false, now: at(s)) == .none)
    }
    #expect(p.inMeeting == false)
    // Even unnamed, our pid does not count.
    let unnamed = MeetingSignal(
      inputRunningSomewhere: true, processes: [AudioProcess(pid: me, bundleID: nil, runningInput: true)])
    #expect(p.update(signal: unnamed, isRecording: false, now: at(40)) == .none)
    #expect(p.update(signal: unnamed, isRecording: false, now: at(50)) == .none)
  }

  @Test func ignoresDictationAndBriefUse() {
    var p = policy()
    let siri = MeetingSignal(
      inputRunningSomewhere: true,
      processes: [AudioProcess(pid: 9, bundleID: "com.apple.corespeechd", runningInput: true)])
    #expect(p.update(signal: siri, isRecording: false, now: at(0)) == .none)
    #expect(p.update(signal: siri, isRecording: false, now: at(10)) == .none)
    // Under `confirmAfter`, then gone: never a prompt.
    #expect(p.update(signal: zoom(), isRecording: false, now: at(20)) == .none)
    #expect(p.update(signal: quiet, isRecording: false, now: at(23)) == .none)
    #expect(p.update(signal: quiet, isRecording: false, now: at(40)) == .none)
  }

  @Test func withoutAProcessListTheDeviceFlagCountsWhenNotRecording() {
    var p = policy()
    let busy = MeetingSignal(inputRunningSomewhere: true, processes: nil)
    #expect(p.update(signal: busy, isRecording: false, now: at(0)) == .none)
    #expect(p.update(signal: busy, isRecording: false, now: at(6)) == .prompt(app: nil))
  }

  @Test func namesTheMeetingAppOverTheBrowser() {
    #expect(MeetingApps.pick(["com.google.Chrome.helper", "com.microsoft.teams2"]) == "Microsoft Teams")
    #expect(MeetingApps.pick(["com.google.Chrome.helper"]) == "Google Chrome")
    #expect(MeetingApps.pick(["com.example.unknown"]) == nil)
    #expect(MeetingApps.name(forBundleID: "us.zoom.xos") == "Zoom")
    #expect(MeetingApps.name(forBundleID: "us.zoom.xosx") == nil)
    #expect(MeetingApps.name(forBundleID: "com.tinyspeck.slackmacgap.helper") == "Slack")
    #expect(MeetingApps.isIgnored("com.apple.corespeechd"))
    #expect(MeetingApps.isIgnored("us.zoom.xos") == false)
  }
}
