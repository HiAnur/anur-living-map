import Foundation
import Network

/// A real HTTP listener on 127.0.0.1, for what a URLProtocol stub cannot see:
/// headers URLSession adds below it, like Cookie. Answers every request with
/// `body` and records each request's head.
final class TinyServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "tiny-server")
  private let lock = NSLock()
  private var heads: [String] = []
  let body: String

  init(body: String) throws {
    self.body = body
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }

  /// Starts listening and answers the port.
  func start() async throws -> UInt16 {
    listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
    return try await withCheckedThrowingContinuation { (done: CheckedContinuation<UInt16, Error>) in
      // Only the listener's own serial queue runs this handler.
      nonisolated(unsafe) var resumed = false
      listener.stateUpdateHandler = { [listener] state in
        guard !resumed else { return }
        switch state {
        case .ready:
          resumed = true
          done.resume(returning: listener.port?.rawValue ?? 0)
        case .failed(let error):
          resumed = true
          done.resume(throwing: error)
        default: break
        }
      }
      listener.start(queue: queue)
    }
  }

  func stop() { listener.cancel() }

  /// The request heads received so far, lower-cased.
  var requests: [String] { lock.withLock { heads } }

  private func serve(_ connection: NWConnection) {
    connection.start(queue: queue)
    read(connection, Data())
  }

  private func read(_ connection: NWConnection, _ soFar: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, _ in
      guard let self else { return }
      var all = soFar
      if let data { all.append(data) }
      let text = String(decoding: all, as: UTF8.self)
      guard let end = text.range(of: "\r\n\r\n") else {
        if !done { self.read(connection, all) }
        return
      }
      let head = String(text[..<end.lowerBound])
      let length = head.lowercased().components(separatedBy: "\r\n")
        .first { $0.hasPrefix("content-length:") }
        .flatMap { Int($0.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) } ?? 0
      if all.count - text[..<end.upperBound].utf8.count < length, !done {
        self.read(connection, all)
        return
      }
      self.lock.withLock { self.heads.append(head.lowercased()) }
      let reply =
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(self.body.utf8.count)\r\nConnection: close\r\n\r\n\(self.body)"
      connection.send(content: Data(reply.utf8), completion: .contentProcessed { _ in connection.cancel() })
    }
  }
}
