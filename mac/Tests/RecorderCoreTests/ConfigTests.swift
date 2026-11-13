import Foundation
import Testing

@testable import RecorderCore

@Suite struct ConfigTests {
  let home = URL(fileURLWithPath: "/Users/someone", isDirectory: true)

  @Test func baseURLPrefersEnvThenSettingThenDefault() {
    #expect(
      ServerConfig.baseURL(env: ["LIVING_MAP_URL": "http://127.0.0.1:5000/"], setting: "http://localhost:6000")
        .absoluteString == "http://127.0.0.1:5000")
    #expect(ServerConfig.baseURL(env: [:], setting: "http://localhost:6000").absoluteString == "http://localhost:6000")
    #expect(ServerConfig.baseURL(env: [:], setting: nil) == ServerConfig.defaultURL)
    #expect(ServerConfig.defaultURL.absoluteString == "http://localhost:4317")
    // Not http(s): skipped, not trusted.
    #expect(ServerConfig.baseURL(env: ["LIVING_MAP_URL": "file:///etc"], setting: "") == ServerConfig.defaultURL)
    #expect(ServerConfig.baseURL(env: ["LIVING_MAP_URL": "nonsense"], setting: nil) == ServerConfig.defaultURL)
  }

  @Test func tokenFileFollowsLivingMapHome() {
    #expect(
      ServerConfig.resolve(env: [:], urlSetting: nil, home: home).tokenFile.path
        == "/Users/someone/.living-map/token")
    #expect(
      ServerConfig.resolve(env: ["LIVING_MAP_HOME": "/tmp/lm-test"], urlSetting: nil, home: home).tokenFile.path
        == "/tmp/lm-test/token")
  }

  @Test func tokenIsTrimmedAndMissingIsNil() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let file = dir.appendingPathComponent("token")
    #expect(ServerConfig.readToken(at: file) == nil)
    try "abc123\n".write(to: file, atomically: true, encoding: .utf8)
    #expect(ServerConfig.readToken(at: file) == "abc123")
    try "  \n".write(to: file, atomically: true, encoding: .utf8)
    #expect(ServerConfig.readToken(at: file) == nil)
  }

  @Test func signInPathsJoinTheBase() {
    let config = ServerConfig(baseURL: URL(string: "http://localhost:4317")!, tokenFile: home)
    #expect(config.absolute("/auth?n=abc&conv=m-1")?.absoluteString == "http://localhost:4317/auth?n=abc&conv=m-1")
    #expect(config.absolute("auth?n=abc")?.absoluteString == "http://localhost:4317/auth?n=abc")
    #expect(config.port == 4317)
    let custom = ServerConfig(baseURL: URL(string: "http://localhost:5555")!, tokenFile: home)
    #expect(custom.absolute("/api/health")?.absoluteString == "http://localhost:5555/api/health")
    #expect(custom.port == 5555)
  }

  @Test func appDirFromEnvSettingOrAKnownClone() {
    let present: Set<String> = [
      "/env/dir/skill/start.ts", "/set/dir/skill/start.ts", "/Users/someone/workspace/anur-living-map/skill/start.ts",
    ]
    let exists: (String) -> Bool = { present.contains($0) }
    #expect(
      AppDirResolver.resolve(env: ["LIVING_MAP_APP_DIR": "/env/dir"], setting: "/set/dir", home: home, exists: exists)
        == "/env/dir")
    #expect(AppDirResolver.resolve(env: [:], setting: "/set/dir", home: home, exists: exists) == "/set/dir")
    #expect(
      AppDirResolver.resolve(env: [:], setting: "/missing", home: home, exists: exists)
        == "/Users/someone/workspace/anur-living-map")
    #expect(AppDirResolver.resolve(env: [:], setting: nil, home: home, exists: { _ in false }) == nil)
    #expect(AppDirResolver.startCommand(appDir: "/x") == "node /x/skill/start.ts")
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
    for n in 0..<12 { settings.remember(RecentMeeting(conv: "c\(n)", title: "T\(n)", date: Date())) }
    settings.remember(RecentMeeting(conv: "c5", title: "again", date: Date()))
    let list = settings.recent
    #expect(list.count == RecorderSettings.maxRecent)
    #expect(list.first?.conv == "c5")
    #expect(list.first?.title == "again")
    #expect(Set(list.map(\.conv)).count == list.count)
    #expect(settings.detectMeetings)
    settings.detectMeetings = false
    #expect(settings.detectMeetings == false)
  }

  @Test func pendingStoreRoundTrips() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = PendingStore(folder: dir)
    store.save(.init(conv: "m/1", ended: true, segments: [seg(1), seg(2)]))
    store.save(.init(conv: "m2", ended: false, segments: [seg(3)]))
    #expect(store.all().map(\.conv).sorted() == ["m/1", "m2"])
    #expect(store.all().first { $0.conv == "m/1" }?.segments.map(\.text) == ["s1", "s2"])
    // Nothing left and not ended: nothing to keep.
    store.save(.init(conv: "m2", ended: false, segments: []))
    #expect(store.all().map(\.conv) == ["m/1"])
    store.remove(conv: "m/1")
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
