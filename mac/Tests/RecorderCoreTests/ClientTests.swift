import Foundation
import Testing

@testable import RecorderCore

/// One shared URLProtocol stub, so these run one at a time.
@Suite(.serialized)
struct ClientTests {
  let config = ServerConfig(baseURL: URL(string: "http://localhost:4999")!)

  func client() -> LivingMapClient { LivingMapClient(config: config, session: StubProtocol.session()) }

  @Test func startMeetingPostsTitleAppAndWhoIsRecording() async throws {
    StubProtocol.reset { _ in .json(200, #"{"name":"launch-sync","title":"Launch sync","href":"/launch-sync/"}"#) }
    let start = try await client().startMeeting(title: "Launch sync", app: "Zoom", by: "Harshit")
    #expect(start == MeetingStart(name: "launch-sync", title: "Launch sync", href: "/launch-sync/"))

    let request = try #require(StubProtocol.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "http://localhost:4999/api/meetings")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let body = try #require(request.jsonBody)
    #expect(body["title"] as? String == "Launch sync")
    #expect(body["app"] as? String == "Zoom")
    #expect(body["by"] as? String == "Harshit")
  }

  @Test func noTokenAndNoBrowserHeaders() async throws {
    StubProtocol.reset { _ in .json(200, #"{"name":"m","title":"M","href":"/m/"}"#) }
    _ = try await client().startMeeting(by: "Harshit")
    let request = try #require(StubProtocol.requests.first)
    let headers = request.allHTTPHeaderFields ?? [:]
    for name in ["X-LM-Token", "Cookie", "Origin", "Sec-Fetch-Site"] {
      #expect(headers.keys.contains { $0.caseInsensitiveCompare(name) == .orderedSame } == false, "\(name) was sent")
    }
    let body = try #require(request.jsonBody)
    #expect(Set(body.keys) == ["by"])
  }

  /// Over a real socket, since URLSession adds cookies below a URLProtocol stub.
  @Test func neverSendsACookieEvenWhenOneIsStored() async throws {
    let server = try TinyServer(body: #"{"ok":true,"version":"1.2.3"}"#)
    let port = try await server.start()
    defer { server.stop() }
    let base = URL(string: "http://127.0.0.1:\(port)")!
    let cookie = HTTPCookie(properties: [
      .domain: "127.0.0.1", .path: "/", .name: "lm", .value: "browser-session", .originURL: base,
    ])!
    HTTPCookieStorage.shared.setCookie(cookie)
    defer { HTTPCookieStorage.shared.deleteCookie(cookie) }

    // A session that keeps cookies sends it…
    let leaky = URLSession(configuration: .default)
    var request = URLRequest(url: base.appendingPathComponent("api/version"))
    request.httpShouldHandleCookies = true
    _ = try await leaky.data(for: request)
    #expect(server.requests.last?.contains("cookie: lm=browser-session") == true)

    // …the client's own session does not, for posts or the up check.
    let client = LivingMapClient(config: ServerConfig(baseURL: base))
    try await client.endMeeting(name: "m")
    #expect(await client.isUp())
    let mine = server.requests.dropFirst()
    #expect(mine.count == 2)
    for head in mine {
      #expect(head.contains("cookie:") == false, "sent \(head)")
      #expect(head.contains("origin:") == false)
      #expect(head.contains("sec-fetch-site:") == false)
      #expect(head.contains("x-lm-token:") == false)
    }
  }

  @Test func segmentsAreSentInOrderWithSpeakerAndEpochMillis() async throws {
    StubProtocol.reset { _ in .json(200, #"{"ok":true,"count":2}"#) }
    let segments = [
      Segment(text: "Hello there.", speaker: .you, start: 1_700_000_000_000, end: 1_700_000_001_500),
      Segment(text: "Hi!", speaker: .others, start: 1_700_000_002_000, end: 1_700_000_002_400),
    ]
    let count = try await client().sendSegments(name: "launch-sync", segments)
    #expect(count == 2)

    let request = try #require(StubProtocol.requests.first)
    #expect(request.url?.path == "/api/meetings/launch-sync/segments")
    let sent = try #require(request.jsonBody?["segments"] as? [[String: Any]])
    #expect(sent.map { $0["text"] as? String } == ["Hello there.", "Hi!"])
    #expect(sent.map { $0["speaker"] as? String } == ["you", "others"])
    #expect(sent[0]["start"] as? Double == 1_700_000_000_000)
    #expect(sent[0]["end"] as? Double == 1_700_000_001_500)
  }

  @Test func endPostsAnEmptyBodyAndEscapesTheName() async throws {
    StubProtocol.reset { _ in .json(200, #"{"ok":true}"#) }
    try await client().endMeeting(name: "a/b c")
    let request = try #require(StubProtocol.requests.first)
    #expect(request.url?.absoluteString == "http://localhost:4999/api/meetings/a%2Fb%20c/end")
    #expect(request.jsonBody?.isEmpty == true)
  }

  @Test func importSendsTextMeAndBy() async throws {
    StubProtocol.reset { _ in .json(200, #"{"name":"notes","title":"Notes","href":"/notes/"}"#) }
    let imported = try await client().importTranscript(
      title: "Notes", text: "We agreed to ship.", me: "Harshit Khandelwal", by: "Harshit")
    #expect(imported.href == "/notes/")
    let request = try #require(StubProtocol.requests.last)
    #expect(request.url?.path == "/api/meetings/import")
    let body = try #require(request.jsonBody)
    #expect(body["title"] as? String == "Notes")
    #expect(body["text"] as? String == "We agreed to ship.")
    #expect(body["me"] as? String == "Harshit Khandelwal")
    #expect(body["by"] as? String == "Harshit")
  }

  @Test func refusalsCarryTheServersWordsAndAreNotRetried() async throws {
    StubProtocol.reset { _ in .json(400, #"{"error":"That meeting has ended."}"#) }
    await #expect(throws: LivingMapError.server(status: 400, message: "That meeting has ended.")) {
      try await client().sendSegments(name: "done", [Segment(text: "x", speaker: .you, start: 0, end: 1)])
    }
    #expect(LivingMapError.server(status: 400, message: "").isRetryable == false)
    #expect(LivingMapError.server(status: 404, message: "").isRetryable == false)
    #expect(LivingMapError.server(status: 503, message: "").isRetryable)
    #expect(LivingMapError.server(status: 400, message: "That meeting has ended.").errorDescription == "That meeting has ended.")

    StubProtocol.reset { _ in .json(400, #"{"error":"The transcript has no words."}"#) }
    await #expect(throws: LivingMapError.server(status: 400, message: "The transcript has no words.")) {
      try await client().importTranscript(title: nil, text: " ", me: nil, by: "Harshit")
    }
  }

  @Test func unreachableIsRetryable() async throws {
    StubProtocol.reset { _ in throw URLError(.cannotConnectToHost) }
    do {
      _ = try await client().startMeeting(by: "Harshit")
      Issue.record("expected a failure")
    } catch let error as LivingMapError {
      guard case .unreachable = error else {
        Issue.record("got \(error)")
        return
      }
      #expect(error.isRetryable)
    }
  }

  @Test func upCheckAsksForTheVersion() async throws {
    StubProtocol.reset { _ in .json(200, #"{"version":"0.4.2","latest":false}"#) }
    #expect(await client().isUp())
    let request = try #require(StubProtocol.requests.first)
    #expect(request.httpMethod == "GET")
    #expect(request.url?.absoluteString == "http://localhost:4999/api/version")

    StubProtocol.reset { _ in .json(200, #"{"app":"living-map","ok":true}"#) }
    #expect(await client().isUp() == false)
    StubProtocol.reset { _ in .json(404, #"{"error":"no"}"#) }
    #expect(await client().isUp() == false)
    StubProtocol.reset { _ in throw URLError(.cannotConnectToHost) }
    #expect(await client().isUp() == false)
  }
}
