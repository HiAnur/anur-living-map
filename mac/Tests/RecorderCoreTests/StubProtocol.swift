import Foundation

/// Answers URLSession requests from a handler the test sets, and records them.
final class StubProtocol: URLProtocol, @unchecked Sendable {
  struct Reply {
    var status: Int
    var body: Data
    static func json(_ status: Int, _ text: String) -> Reply { Reply(status: status, body: Data(text.utf8)) }
  }

  nonisolated(unsafe) private static var handler: ((URLRequest) throws -> Reply)?
  nonisolated(unsafe) private static var seen: [URLRequest] = []
  private static let lock = NSLock()

  static func reset(_ handle: @escaping (URLRequest) throws -> Reply) {
    lock.withLock {
      handler = handle
      seen = []
    }
  }

  static var requests: [URLRequest] { lock.withLock { seen } }

  static func session() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    return URLSession(configuration: config)
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    var request = self.request
    // URLSession hands the body over as a stream; keep it readable for asserts.
    if request.httpBody == nil, let stream = request.httpBodyStream {
      request.httpBody = Self.drain(stream)
    }
    let handle = Self.lock.withLock { () -> ((URLRequest) throws -> Reply)? in
      Self.seen.append(request)
      return Self.handler
    }
    do {
      guard let handle else { throw URLError(.cannotConnectToHost) }
      let reply = try handle(request)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: reply.body)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}

  private static func drain(_ stream: InputStream) -> Data {
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let n = stream.read(&buffer, maxLength: buffer.count)
      if n <= 0 { break }
      data.append(buffer, count: n)
    }
    return data
  }
}

extension URLRequest {
  var jsonBody: [String: Any]? {
    guard let body = httpBody else { return nil }
    return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
  }
}
