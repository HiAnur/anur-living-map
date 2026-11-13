import Foundation
import Testing

@testable import RecorderCore

@Suite struct ConfigTests {
  @Test func baseURLPrefersEnvThenSettingThenDefault() {
    #expect(
      ServerConfig.baseURL(env: ["LIVING_MAP_URL": "http://127.0.0.1:5000/"], setting: "http://localhost:6000")
        .absoluteString == "http://127.0.0.1:5000")
    #expect(ServerConfig.baseURL(env: [:], setting: "http://localhost:6000").absoluteString == "http://localhost:6000")
    #expect(ServerConfig.baseURL(env: [:], setting: nil) == ServerConfig.defaultURL)
    #expect(ServerConfig.defaultURL.absoluteString == "http://localhost:4323")
    // Not http(s): skipped, not trusted.
    #expect(ServerConfig.baseURL(env: ["LIVING_MAP_URL": "file:///etc"], setting: "") == ServerConfig.defaultURL)
    #expect(ServerConfig.baseURL(env: ["LIVING_MAP_URL": "nonsense"], setting: nil) == ServerConfig.defaultURL)
    #expect(ServerConfig.resolve(env: [:], urlSetting: nil).hostAndPort == "localhost:4323")
  }

  @Test func mapPagesJoinTheBase() {
    let config = ServerConfig(baseURL: URL(string: "http://localhost:4323")!)
    #expect(config.absolute("/launch-sync/")?.absoluteString == "http://localhost:4323/launch-sync/")
    #expect(config.mapPage(name: "launch-sync")?.absoluteString == "http://localhost:4323/launch-sync/")
    #expect(config.mapsPage?.absoluteString == "http://localhost:4323/")
    let custom = ServerConfig(baseURL: URL(string: "http://localhost:5555/")!)
    #expect(custom.absolute("api/version")?.absoluteString == "http://localhost:5555/api/version")
    #expect(custom.hostAndPort == "localhost:5555")
  }

  @Test func yourNameIsTheFirstWordUnlessSet() {
    #expect(RecorderSettings.firstName(of: "Harshit Khandelwal") == "Harshit")
    #expect(RecorderSettings.firstName(of: "Priyanka") == "Priyanka")
    #expect(RecorderSettings.firstName(of: "") == "")
    let settings = RecorderSettings(defaults: UserDefaults(suiteName: "recorder-tests-\(UUID().uuidString)")!)
    #expect(settings.yourName == RecorderSettings.firstName(of: NSFullUserName()))
    settings.yourName = "Duy"
    #expect(settings.yourName == "Duy")
    settings.yourName = "  "
    #expect(settings.yourName == RecorderSettings.firstName(of: NSFullUserName()))
  }
}

@Suite struct ImportAndSettingsTests {
  @Test func titlesAndCleaning() throws {
    #expect(TranscriptImport.title(forFile: URL(fileURLWithPath: "/a/Weekly sync.txt")) == "Weekly sync")
    #expect(try TranscriptImport.clean("\r\n  hello\r\nworld  \n") == "hello\nworld")
    #expect(throws: TranscriptImport.Problem.empty) { try TranscriptImport.clean(" \n\t ") }
    #expect(TranscriptImport.defaultTitle().hasPrefix("Imported transcript, "))
  }

  @Test func subtitlesLoseTheirTimings() throws {
    let vtt = """
      WEBVTT

      1
      00:00:01.000 --> 00:00:03.000
      Harshit: Let's ship on Friday.

      2
      00:00:04.000 --> 00:00:06.000
      Duy: Agreed.
      """
    #expect(TranscriptImport.stripCues(vtt) == "\nHarshit: Let's ship on Friday.\n\nDuy: Agreed.")

    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let file = dir.appendingPathComponent("call.vtt")
    try vtt.write(to: file, atomically: true, encoding: .utf8)
    #expect(try TranscriptImport.read(file: file) == "Harshit: Let's ship on Friday.\n\nDuy: Agreed.")
  }

  @Test func recentMeetingsAreUniqueNewestFirstAndCapped() {
    let defaults = UserDefaults(suiteName: "recorder-tests-\(UUID().uuidString)")!
    let settings = RecorderSettings(defaults: defaults)
    for n in 0..<12 { settings.remember(RecentMeeting(name: "c\(n)", title: "T\(n)", date: Date())) }
    settings.remember(RecentMeeting(name: "c5", title: "again", date: Date()))
    let list = settings.recent
    #expect(list.count == RecorderSettings.maxRecent)
    #expect(list.first?.name == "c5")
    #expect(list.first?.title == "again")
    #expect(Set(list.map(\.name)).count == list.count)
    #expect(settings.detectMeetings)
    settings.detectMeetings = false
    #expect(settings.detectMeetings == false)
  }

  @Test func pendingStoreRoundTrips() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = PendingStore(folder: dir)
    store.save(.init(name: "m/1", ended: true, segments: [seg(1), seg(2)]))
    store.save(.init(name: "m2", ended: false, segments: [seg(3)]))
    #expect(store.all().map(\.name).sorted() == ["m/1", "m2"])
    #expect(store.all().first { $0.name == "m/1" }?.segments.map(\.text) == ["s1", "s2"])
    // Nothing left and not ended: nothing to keep.
    store.save(.init(name: "m2", ended: false, segments: []))
    #expect(store.all().map(\.name) == ["m/1"])
    store.remove(name: "m/1")
    #expect(store.all().isEmpty)
  }

  @Test func segmentTimesAreEpochMillis() {
    let origin = Date(timeIntervalSince1970: 1_700_000_000)
    let s = Segment(text: "x", speaker: .others, origin: origin, startSeconds: 1.25, endSeconds: 2.5)
    #expect(s.start == 1_700_000_001_250)
    #expect(s.end == 1_700_000_002_500)
    #expect(Clock.elapsed(65) == "1:05")
    #expect(Clock.elapsed(3725) == "1:02:05")
  }
}
