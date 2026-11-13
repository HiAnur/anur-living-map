import Foundation
import RecorderCore

/// Sends segments left on disk (the server was down when a recording stopped,
/// or the app quit or crashed mid-meeting) and then ends those meetings. Runs
/// at launch, after a stop that left some, and every half minute while any remain.
@MainActor
final class PendingUploader {
  private let store: PendingStore
  private let client: () -> LivingMapClient
  private var timer: Timer?
  private var running = false
  /// The meeting being recorded right now: its file is the live queue's, not ours.
  var activeConv: String?
  private(set) var waiting = 0

  init(store: PendingStore, client: @escaping () -> LivingMapClient) {
    self.store = store
    self.client = client
  }

  func start() {
    timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
      Task { @MainActor in await self?.run() }
    }
    Task { await run() }
  }

  func run() async {
    guard !running else { return }
    running = true
    defer { running = false }
    let client = client()
    var left = 0
    for entry in store.all() where entry.conv != activeConv {
      do {
        var rest = entry.segments
        while !rest.isEmpty {
          let batch = Array(rest.prefix(100))
          try await client.sendSegments(conv: entry.conv, batch)
          rest.removeFirst(batch.count)
          store.save(.init(conv: entry.conv, ended: true, segments: rest))
        }
        try await client.endMeeting(conv: entry.conv)
        store.remove(conv: entry.conv)
        log("sent what was left of \(entry.conv)")
      } catch {
        left += 1
      }
    }
    waiting = left
  }
}
