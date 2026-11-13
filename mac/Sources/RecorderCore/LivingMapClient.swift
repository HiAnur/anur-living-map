import Foundation

public enum LivingMapError: Error, Equatable, LocalizedError, Sendable {
  /// The server answered with a 4xx/5xx; `message` is its `{error}` when it sent one.
  case server(status: Int, message: String)
  /// Nothing answered: the server is not running, or the network failed.
  case unreachable(String)
  /// The server answered something this client cannot read.
  case badAnswer(String)

  public var errorDescription: String? {
    switch self {
    case .server(_, let message): return message
    case .unreachable(let why): return "Anur Living Map is not reachable (\(why))"
    case .badAnswer(let why): return "Anur Living Map sent an answer this app cannot read (\(why))"
    }
  }

  /// Worth trying again later: the server is down, busy or failing. A refusal
  /// (the meeting has ended, the map is gone, the request is wrong) will not
  /// change by asking again.
  public var isRetryable: Bool {
    switch self {
    case .unreachable: return true
    case .server(let status, _): return status >= 500 || status == 408 || status == 429
    case .badAnswer: return false
    }
  }
}

/// The recorder's side of Anur Living Map's meetings API. The server trusts a
/// program on this Mac only when the request carries no Origin, no
/// sec-fetch-site and no Cookie, so this client never sends cookies: a cookie
/// makes the server treat it as a browser and answer 401.
public struct LivingMapClient: Sendable {
  public let config: ServerConfig
  let session: URLSession

  public init(config: ServerConfig, session: URLSession = LivingMapClient.makeSession()) {
    self.config = config
    self.session = session
  }

  /// An ephemeral session that neither stores nor sends cookies.
  public static func makeSession(protocolClasses: [AnyClass]? = nil) -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    if let protocolClasses { configuration.protocolClasses = protocolClasses }
    return URLSession(configuration: configuration)
  }

  /// True when Anur Living Map answers `GET /api/version` with a version.
  public func isUp() async -> Bool {
    guard let url = config.absolute("/api/version") else { return false }
    var request = URLRequest(url: url, timeoutInterval: 3)
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    guard let (data, response) = try? await session.data(for: request),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return false }
    return answer["version"] != nil
  }

  /// A new meeting map; `by` is the person recording, by their team sign-in name.
  public func startMeeting(title: String? = nil, app: String? = nil, by: String) async throws -> MeetingStart {
    try await post("/api/meetings", StartBody(title: title, app: app, by: by))
  }

  @discardableResult
  public func sendSegments(name: String, _ segments: [Segment]) async throws -> Int {
    let answer: CountAnswer = try await post(
      "/api/meetings/\(pathPart(name))/segments", SegmentsBody(segments: segments))
    return answer.count ?? segments.count
  }

  public func endMeeting(name: String) async throws {
    let _: OkAnswer = try await post("/api/meetings/\(pathPart(name))/end", EmptyBody())
  }

  /// A finished meeting from a whole transcript; `me` is how you appear in it.
  public func importTranscript(title: String?, text: String, me: String?, by: String) async throws -> MeetingStart {
    try await post("/api/meetings/import", ImportBody(title: title, text: text, me: me, by: by))
  }

  // MARK: - plumbing

  private func pathPart(_ name: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/?#")
    return name.addingPercentEncoding(withAllowedCharacters: allowed) ?? name
  }

  private func post<Body: Encodable, Answer: Decodable>(_ path: String, _ body: Body) async throws
    -> Answer
  {
    guard let url = config.absolute(path) else { throw LivingMapError.badAnswer("bad URL \(path)") }
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = "POST"
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
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
