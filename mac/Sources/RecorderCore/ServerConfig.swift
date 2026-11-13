import Foundation

/// Where the Anur Living Map server is: the environment first, then the app's
/// own setting, then the default. Every input is passed in, so the order can be
/// tested without touching the Mac.
public struct ServerConfig: Equatable, Sendable {
  public static let defaultURL = URL(string: "http://localhost:4323")!

  public var baseURL: URL

  public init(baseURL: URL) { self.baseURL = baseURL }

  public static func resolve(env: [String: String], urlSetting: String?) -> ServerConfig {
    ServerConfig(baseURL: baseURL(env: env, setting: urlSetting))
  }

  /// `LIVING_MAP_URL`, else the hidden setting, else localhost:4323. A value
  /// that is not an http(s) URL is skipped rather than trusted.
  public static func baseURL(env: [String: String], setting: String?) -> URL {
    for candidate in [env["LIVING_MAP_URL"], setting] {
      if let url = httpURL(candidate) { return url }
    }
    return defaultURL
  }

  /// `localhost:4323`, for telling you where the server was looked for.
  public var hostAndPort: String {
    let port = baseURL.port ?? (baseURL.scheme == "https" ? 443 : 80)
    return "\(baseURL.host ?? baseURL.absoluteString):\(port)"
  }

  /// `base + path`, where `path` is a path the server answered (`/launch-sync/`).
  public func absolute(_ path: String) -> URL? {
    if let full = URL(string: path), full.scheme != nil, full.host != nil { return full }
    var base = baseURL.absoluteString
    while base.hasSuffix("/") { base.removeLast() }
    return URL(string: base + (path.hasPrefix("/") ? path : "/" + path))
  }

  /// The page of a meeting's map, by the map's name.
  public func mapPage(name: String) -> URL? { absolute("/\(name)/") }

  /// The list of maps.
  public var mapsPage: URL? { absolute("/") }

  private static func httpURL(_ text: String?) -> URL? {
    guard var text = text?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return nil }
    while text.hasSuffix("/") { text.removeLast() }
    guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https", url.host != nil
    else { return nil }
    return url
  }
}
