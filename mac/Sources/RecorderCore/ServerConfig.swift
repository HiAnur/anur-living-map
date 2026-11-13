import Foundation

/// Where the Living Map server is and how to sign requests to it, resolved from
/// the environment first, then the app's own settings, then the defaults.
/// Every input is passed in, so the order can be tested without touching the Mac.
public struct ServerConfig: Equatable, Sendable {
  public static let defaultURL = URL(string: "http://localhost:4317")!

  public var baseURL: URL
  /// `~/.living-map/token`, or `$LIVING_MAP_HOME/token`.
  public var tokenFile: URL

  public init(baseURL: URL, tokenFile: URL) {
    self.baseURL = baseURL
    self.tokenFile = tokenFile
  }

  public static func resolve(
    env: [String: String], urlSetting: String?, home: URL
  ) -> ServerConfig {
    ServerConfig(
      baseURL: baseURL(env: env, setting: urlSetting),
      tokenFile: livingMapHome(env: env, home: home).appendingPathComponent("token"))
  }

  /// `LIVING_MAP_URL`, else the hidden setting, else localhost:4317. A value
  /// that is not an http(s) URL is skipped rather than trusted.
  public static func baseURL(env: [String: String], setting: String?) -> URL {
    for candidate in [env["LIVING_MAP_URL"], setting] {
      if let url = httpURL(candidate) { return url }
    }
    return defaultURL
  }

  public static func livingMapHome(env: [String: String], home: URL) -> URL {
    if let custom = env["LIVING_MAP_HOME"], !custom.isEmpty {
      return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath, isDirectory: true)
    }
    return home.appendingPathComponent(".living-map", isDirectory: true)
  }

  /// The token as the server wrote it, trimmed; nil when the file is missing or empty.
  public static func readToken(at file: URL) -> String? {
    guard let raw = try? String(contentsOf: file, encoding: .utf8) else { return nil }
    let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return token.isEmpty ? nil : token
  }

  /// The port in the base URL, for starting a server that should listen there.
  public var port: Int { baseURL.port ?? (baseURL.scheme == "https" ? 443 : 80) }

  /// `base + path`, where `path` is a relative path the server answered (`/auth?n=…`).
  public func absolute(_ path: String) -> URL? {
    if let full = httpURL(path), full.host != nil { return full }
    var base = baseURL.absoluteString
    while base.hasSuffix("/") { base.removeLast() }
    return URL(string: base + (path.hasPrefix("/") ? path : "/" + path))
  }

  private static func httpURL(_ text: String?) -> URL? {
    guard var text = text?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return nil }
    while text.hasSuffix("/") { text.removeLast() }
    guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https", url.host != nil
    else { return nil }
    return url
  }

  private func httpURL(_ text: String) -> URL? { Self.httpURL(text) }
}

/// Where the Living Map app (the folder holding `skill/start.ts`) lives, so the
/// recorder can start the server when it is not running.
public enum AppDirResolver {
  public static let startScript = "skill/start.ts"

  /// `LIVING_MAP_APP_DIR`, else the setting, else the first common clone
  /// location that holds the start script; nil when none does.
  public static func resolve(
    env: [String: String], setting: String?, home: URL,
    exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
  ) -> String? {
    var candidates: [String] = []
    if let dir = env["LIVING_MAP_APP_DIR"], !dir.isEmpty { candidates.append(dir) }
    if let dir = setting, !dir.isEmpty { candidates.append(dir) }
    for name in ["workspace/anur-living-map", "workspace/living-map", "anur-living-map", "living-map"] {
      candidates.append(home.appendingPathComponent(name).path)
    }
    for dir in candidates {
      let expanded = (dir as NSString).expandingTildeInPath
      if exists((expanded as NSString).appendingPathComponent(startScript)) { return expanded }
    }
    return nil
  }

  /// The command to show when the server is down and cannot be started from here.
  public static func startCommand(appDir: String?) -> String {
    "node \(appDir ?? "<Living Map folder>")/\(startScript)"
  }
}
