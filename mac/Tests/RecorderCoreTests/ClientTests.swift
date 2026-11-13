import Foundation
import Testing

@testable import RecorderCore

/// One shared URLProtocol stub, so these run one at a time.
@Suite(.serialized)
struct ClientTests {
  let config = ServerConfig(
    baseURL: URL(string: "http://localhost:4999")!, tokenFile: URL(fileURLWithPath: "/nonexistent/token"))

  func client(token: String? = "tok-123") -> LivingMapClient {
    LivingMapClient(config: config, session: StubProtocol.session(), token: { token })
  }

  @Test func startMeetingPostsTitleAndAppWithToken() async throws {
    StubProtocol.reset { _ in .json(200, #"{"conv":"m-1","title":"Standup","url":"/auth?n=abc&conv=m-1"}"#) }
    let start = try await client().startMeeting(title: "Standup", app: "Zoom")
    #expect(start == MeetingStart(conv: "m-1", title: "Standup", url: "/auth?n=abc&conv=m-1"))

    let request = try #require(StubProtocol.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "http://localhost:4999/api/meetings")
    #expect(request.value(forHTTPHeaderField: "X-LM-Token") == "tok-123")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let body = try #require(request.jsonBody)
    #expect(body["title"] as? String == "Standup")
    #expect(body["app"] as? String == "Zoom")
  }

  @Test func startMeetingLeavesOutMissingFields() async throws {
    StubProtocol.reset { _ in .json(200, #"{"conv":"m-2","title":"Meeting","url":"/auth?n=x"}"#) }
    _ = try await client().startMeeting()
    let body = try #require(StubProtocol.requests.first?.jsonBody)
    #expect(body.isEmpty)
  }

  @Test func segmentsAreSentInOrderWithSpeakerAndEpochMillis() async throws {
    StubProtocol.reset { _ in .json(200, #"{"ok":true,"count":2}"#) }
    let segments = [
      Segment(text: "Hello there.", speaker: .you, start: 1_700_000_000_000, end: 1_700_000_001_500),
      Segment(text: "Hi!", speaker: .others, start: 1_700_000_002_000, end: 1_700_000_002_400),
    ]
    let count = try await client().sendSegments(conv: "m-1", segments)
    #expect(count == 2)

    let request = try #require(StubProtocol.requests.first)
    #expect(request.url?.path == "/api/meetings/m-1/segments")
    let sent = try #require(request.jsonBody?["segments"] as? [[String: Any]])
    #expect(sent.map { $0["text"] as? String } == ["Hello there.", "Hi!"])
    #expect(sent.map { $0["speaker"] as? String } == ["you", "others"])
    #expect(sent[0]["start"] as? Double == 1_700_000_000_000)
    #expect(sent[0]["end"] as? Double == 1_700_000_001_500)
  }

  @Test func convIsEscapedInThePath() async throws {
    StubProtocol.reset { _ in .json(200, #"{"ok":true}"#) }
    try await client().endMeeting(conv: "a/b c")
    let url = try #require(StubProtocol.requests.first?.url)
    #expect(url.absoluteString == "http://localhost:4999/api/meetings/a%2Fb%20c/end")
    #expect(StubProtocol.requests.first?.jsonBody?.isEmpty == true)
  }

  @Test func openAndImport() async throws {
    StubProtocol.reset { request in
      if request.url?.path == "/api/meetings/m-1/open" { return .json(200, #"{"url":"/auth?n=new&conv=m-1"}"#) }
      return .json(200, #"{"conv":"m-9","title":"Notes","url":"/auth?n=i&conv=m-9"}"#)
    }
    #expect(try await client().openMeeting(conv: "m-1") == "/auth?n=new&conv=m-1")
    let imported = try await client().importTranscript(
      title: "Notes", text: "We agreed to ship.", me: "Harshit Khandelwal")
    #expect(imported.conv == "m-9")
    let body = try #require(StubProtocol.requests.last?.jsonBody)
    #expect(StubProtocol.requests.last?.url?.path == "/api/meetings/import")
    #expect(body["title"] as? String == "Notes")
    #expect(body["text"] as? String == "We agreed to ship.")
    #expect(body["me"] as? String == "Harshit Khandelwal")
  }

  @Test func serverErrorsCarryTheirMessage() async throws {
    StubProtocol.reset { _ in .json(404, #"{"error":"no such meeting"}"#) }
    await #expect(throws: LivingMapError.server(status: 404, message: "no such meeting")) {
      try await client().endMeeting(conv: "gone")
    }
    #expect(LivingMapError.server(status: 404, message: "").isRetryable == false)
    #expect(LivingMapError.server(status: 503, message: "").isRetryable)
  }

  @Test func unreachableAndMissingToken() async throws {
    StubProtocol.reset { _ in throw URLError(.cannotConnectToHost) }
    do {
      _ = try await client().startMeeting()
      Issue.record("expected a failure")
    } catch let error as LivingMapError {
      guard case .unreachable = error else { Issue.record("got \(error)"); return }
      #expect(error.isRetryable)
    }
    StubProtocol.reset { _ in .json(200, "{}") }
    await #expect(throws: LivingMapError.noToken(path: "/nonexistent/token")) {
      try await client(token: nil).startMeeting()
    }
    #expect(StubProtocol.requests.isEmpty)
  }

  @Test func healthNeedsNoTokenAndChecksTheApp() async throws {
    StubProtocol.reset { _ in .json(200, #"{"app":"living-map","ok":true}"#) }
    #expect(await client(token: nil).health())
    #expect(StubProtocol.requests.first?.value(forHTTPHeaderField: "X-LM-Token") == nil)
    #expect(StubProtocol.requests.first?.httpMethod == "GET")

    StubProtocol.reset { _ in .json(200, #"{"app":"something-else"}"#) }
    #expect(await client().health() == false)
    StubProtocol.reset { _ in throw URLError(.cannotConnectToHost) }
    #expect(await client().health() == false)
  }
}
