import Foundation
import RecorderCore

/// Whether the Living Map server answers, and starting it with the app's
/// `skill/start.ts` when the folder is known.
@MainActor
final class ServerWatch {
  enum State: Equatable {
    case unknown, up, down, starting
  }

  private(set) var state: State = .unknown
  private(set) var lastStartError: String?
  var onChange: (() -> Void)?
  private let settings: RecorderSettings
  private var timer: Timer?

  init(settings: RecorderSettings) { self.settings = settings }

  var env: [String: String] { ProcessInfo.processInfo.environment }

  var config: ServerConfig {
    ServerConfig.resolve(env: env, urlSetting: settings.serverURL, home: FileManager.default.homeDirectoryForCurrentUser)
  }

  var client: LivingMapClient { LivingMapClient(config: config) }

  var appDir: String? {
    AppDirResolver.resolve(env: env, setting: settings.appDir, home: FileManager.default.homeDirectoryForCurrentUser)
  }

  var startCommand: String { AppDirResolver.startCommand(appDir: appDir) }

  func watch() {
    timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
      Task { @MainActor in await self?.refresh() }
    }
    Task { await refresh() }
  }

  @discardableResult
  func refresh() async -> Bool {
    let up = await client.health()
    if state != .starting {
      set(up ? .up : .down)
    }
    return up
  }

  /// Runs `node <appDir>/skill/start.ts` in a login shell (a menu-bar app's PATH
  /// rarely has node) and waits for it; true when the server then answers.
  func startServer() async -> Bool {
    guard let appDir else {
      lastStartError = "The Living Map folder is not known."
      return false
    }
    set(.starting)
    lastStartError = nil
    let script = (appDir as NSString).appendingPathComponent(AppDirResolver.startScript)
    let port = config.port
    let result = await Task.detached { () -> (Int32, String) in
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/zsh")
      process.arguments = ["-lc", "node \"$1\"", "zsh", script]
      process.currentDirectoryURL = URL(fileURLWithPath: appDir)
      var environment = ProcessInfo.processInfo.environment
      environment["PORT"] = String(port)
      process.environment = environment
      let output = Pipe()
      process.standardOutput = output
      process.standardError = output
      do {
        try process.run()
      } catch {
        return (-1, error.localizedDescription)
      }
      let data = output.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }.value
    if result.0 != 0 {
      lastStartError = result.1.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n").last.map(String.init)
        ?? "exit \(result.0)"
      log("start.ts failed: \(result.1)")
    }
    state = .unknown
    return await refresh()
  }

  private func set(_ new: State) {
    guard new != state else { return }
    state = new
    onChange?()
  }
}
