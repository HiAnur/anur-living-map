import Foundation
import RecorderCore

/// Sends segments left on disk (the server was down when a recording stopped,
/// or the app quit or crashed mid-meeting) and then ends those meetings. Runs
/// at launch, after a stop that left some, and every half minute while any remain.
/// A meeting the server refuses (ended, or its map gone) is dropped, not retried.
@MainActor
final class PendingUploader {
  private let store: PendingStore
  private let client: () -> LivingMapClient
  private var timer: Timer?
  private var running = false
  /// The meeting being recorded right now: its file is the live queue's, not ours.
  var activeName: String?
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
    for entry in store.all() where entry.name != activeName {
      do {
        var rest = entry.segments
        while !rest.isEmpty {
          let batch = Array(rest.prefix(100))
          do {
            try await client.sendSegments(name: entry.name, batch)
          } catch where SegmentQueue.isRefusal(error) {
            log("\(entry.name) refused \(batch.count) segment(s): \(error.localizedDescription)")
          }
          rest.removeFirst(batch.count)
          store.save(.init(name: entry.name, ended: true, segments: rest))
        }
        do {
          try await client.endMeeting(name: entry.name)
        } catch where SegmentQueue.isRefusal(error) {
          log("\(entry.name) could not be ended: \(error.localizedDescription)")
        }
        store.remove(name: entry.name)
        log("sent what was left of \(entry.name)")
      } catch {
        left += 1
      }
    }
    waiting = left
  }
}
