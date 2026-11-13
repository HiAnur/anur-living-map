import Foundation

public enum LivingMapError: Error, Equatable, LocalizedError, Sendable {
  /// The server answered with a 4xx/5xx; `message` is its `{error}` when it sent one.
  case server(status: Int, message: String)
  /// Nothing answered: the server is not running, or the network failed.
  case unreachable(String)
  /// The server answered something this client cannot read.
  case badAnswer(String)
  /// There is no token file yet (the server writes it on its first start).
  case noToken(path: String)

  public var errorDescription: String? {
    switch self {
    case .server(let status, let message): return "Living Map answered \(status): \(message)"
    case .unreachable(let why): return "Living Map is not reachable (\(why))"
    case .badAnswer(let why): return "Living Map sent an answer this app cannot read (\(why))"
    case .noToken(let path): return "No Living Map token at \(path); start the server once"
    }
  }

  /// Worth trying again later: the server is down, busy or failing, not refusing the request.
  public var isRetryable: Bool {
    switch self {
    case .unreachable, .noToken: return true
    case .server(let status, _): return status >= 500 || status == 408 || status == 429
    case .badAnswer: return false
    }
  }
}

/// The recorder's side of the Living Map meetings API. Every call but `health`
/// sends `X-LM-Token`, read from the token file on each request so a server that
/// started after the app still works.
public struct LivingMapClient: Sendable {
  public let config: ServerConfig
  let session: URLSession
  let token: @Sendable () -> String?

  public init(
    config: ServerConfig, session: URLSession = .shared,
    token: (@Sendable () -> String?)? = nil
  ) {
    self.config = config
    self.session = session
    let file = config.tokenFile
    self.token = token ?? { ServerConfig.readToken(at: file) }
  }

  /// True when a Living Map server answers on the base URL.
  public func health() async -> Bool {
    guard let url = endpoint("/api/health") else { return false }
    var request = URLRequest(url: url, timeoutInterval: 3)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    guard let (data, response) = try? await session.data(for: request),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let answer = try? JSONDecoder().decode(HealthAnswer.self, from: data)
    else { return false }
    return answer.app == "living-map"
  }

  public func startMeeting(title: String? = nil, app: String? = nil) async throws -> MeetingStart {
    try await post("/api/meetings", StartBody(title: title, app: app))
  }

  @discardableResult
  public func sendSegments(conv: String, _ segments: [Segment]) async throws -> Int {
    let answer: CountAnswer = try await post(
      "/api/meetings/\(pathPart(conv))/segments", SegmentsBody(segments: segments))
    return answer.count ?? segments.count
  }

  public func endMeeting(conv: String) async throws {
    let _: OkAnswer = try await post("/api/meetings/\(pathPart(conv))/end", EmptyBody())
  }

  /// A fresh one-time sign-in path for reopening a meeting's map.
  public func openMeeting(conv: String) async throws -> String {
    let answer: URLAnswer = try await post("/api/meetings/\(pathPart(conv))/open", EmptyBody())
    return answer.url
  }

  public func importTranscript(title: String, text: String, me: String? = nil) async throws
    -> MeetingStart
  {
    try await post("/api/meetings/import", ImportBody(title: title, text: text, me: me))
  }

  // MARK: - plumbing

  func endpoint(_ path: String) -> URL? { config.absolute(path) }

  private func pathPart(_ conv: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/?#")
    return conv.addingPercentEncoding(withAllowedCharacters: allowed) ?? conv
  }

  private func post<Body: Encodable, Answer: Decodable>(_ path: String, _ body: Body) async throws
    -> Answer
  {
    guard let url = endpoint(path) else { throw LivingMapError.badAnswer("bad URL \(path)") }
    guard let token = token() else { throw LivingMapError.noToken(path: config.tokenFile.path) }
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue(token, forHTTPHeaderField: "X-LM-Token")
    request.httpBody = try JSONEncoder().encode(body)

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw LivingMapError.unreachable(error.localizedDescription)
    }
    guard let http = response as? HTTPURLResponse else {
      throw LivingMapError.badAnswer("not HTTP")
    }
    guard (200..<300).contains(http.statusCode) else {
      let message =
        (try? JSONDecoder().decode(ErrorAnswer.self, from: data))?.error
        ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
      throw LivingMapError.server(status: http.statusCode, message: message)
    }
    do {
      return try JSONDecoder().decode(Answer.self, from: data)
    } catch {
      throw LivingMapError.badAnswer(String(describing: error))
    }
  }
}
