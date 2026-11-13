import Foundation
import RecorderCore

/// Whether Anur Living Map answers. The recorder never starts it: you open it
/// with /anur-living-map in Claude Code.
@MainActor
final class ServerWatch {
  enum State: Equatable {
    case unknown, up, down
  }

  private(set) var state: State = .unknown
  var onChange: (() -> Void)?
  private let settings: RecorderSettings
  private var timer: Timer?

  init(settings: RecorderSettings) { self.settings = settings }

  var config: ServerConfig {
    ServerConfig.resolve(env: ProcessInfo.processInfo.environment, urlSetting: settings.serverURL)
  }

  var client: LivingMapClient { LivingMapClient(config: config) }

  func watch() {
    timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
      Task { @MainActor in await self?.refresh() }
    }
    Task { await refresh() }
  }

  @discardableResult
  func refresh() async -> Bool {
    let up = await client.isUp()
    let new: State = up ? .up : .down
    if new != state {
      state = new
      onChange?()
    }
    return up
  }
}
