import Foundation
import Testing

@testable import RecorderCore

/// A server stand-in: records each batch it accepts and fails on demand.
actor FakeServer {
  var received: [[Segment]] = []
  var failNext = 0
  var attempts = 0

  func failing(_ times: Int) { failNext = times }

  func take(_ batch: [Segment]) throws {
    attempts += 1
    if failNext > 0 {
      failNext -= 1
      throw LivingMapError.unreachable("down")
    }
    received.append(batch)
  }

  var texts: [String] { received.flatMap { $0.map(\.text) } }
}

func seg(_ n: Int, _ speaker: Speaker = .you) -> Segment {
  Segment(text: "s\(n)", speaker: speaker, start: Double(n * 1000), end: Double(n * 1000 + 500))
}

@Suite struct SegmentQueueTests {
  let noWait: SegmentQueue.Sleep = { _ in }

  @Test func flushSendsInBatchesInOrder() async {
    let server = FakeServer()
    let queue = SegmentQueue(maxBatch: 2, sleep: noWait) { try await server.take($0) }
    for n in 1...5 { await queue.append(seg(n)) }
    #expect(await queue.flush())
    #expect(await server.received.map { $0.count } == [2, 2, 1])
    #expect(await server.texts == ["s1", "s2", "s3", "s4", "s5"])
    #expect(await queue.pending.isEmpty)
    #expect(await queue.sentCount == 5)
  }

  @Test func failedSendKeepsEverythingInOrderForTheRetry() async {
    let server = FakeServer()
    let queue = SegmentQueue(maxBatch: 2, sleep: noWait) { try await server.take($0) }
    for n in 1...3 { await queue.append(seg(n)) }
    await server.failing(1)
    #expect(await queue.flush() == false)
    #expect(await queue.pending.map(\.text) == ["s1", "s2", "s3"])
    #expect(await queue.failures == 1)
    #expect(await queue.lastError != nil)

    await queue.append(seg(4))
    #expect(await queue.flush())
    #expect(await server.texts == ["s1", "s2", "s3", "s4"])
    #expect(await queue.failures == 0)
  }

  @Test func failureMidwayKeepsOnlyTheUnsentTail() async {
    let server = FakeServer()
    let queue = SegmentQueue(maxBatch: 2, sleep: noWait) { batch in
      // the second batch fails once
      if batch.first?.text == "s3", await server.attempts == 1 { await server.failing(1) }
      try await server.take(batch)
    }
    for n in 1...4 { await queue.append(seg(n)) }
    #expect(await queue.flush() == false)
    #expect(await queue.pending.map(\.text) == ["s3", "s4"])
    #expect(await queue.flush())
    #expect(await server.texts == ["s1", "s2", "s3", "s4"])
  }

  @Test func concurrentFlushesNeverSendABatchTwice() async {
    let server = FakeServer()
    let queue = SegmentQueue(maxBatch: 1, sleep: noWait) { batch in
      try await Task.sleep(for: .milliseconds(5))
      try await server.take(batch)
    }
    for n in 1...6 { await queue.append(seg(n)) }
    await withTaskGroup(of: Void.self) { group in
      for _ in 0..<4 { group.addTask { await queue.flush() } }
    }
    #expect(await server.texts == ["s1", "s2", "s3", "s4", "s5", "s6"])
  }

  @Test func stopFlushesWhatIsLeftAndRetries() async {
    let server = FakeServer()
    let queue = SegmentQueue(sleep: noWait) { try await server.take($0) }
    await queue.append(seg(1))
    await queue.append(seg(2, .others))
    await server.failing(2)
    let left = await queue.stop(attempts: 5)
    #expect(left == 0)
    #expect(await server.texts == ["s1", "s2"])
    #expect(await server.attempts == 3)
  }

  @Test func stopKeepsSegmentsWhenTheServerStaysDown() async {
    let server = FakeServer()
    let queue = SegmentQueue(sleep: noWait) { try await server.take($0) }
    await queue.append(seg(1))
    await server.failing(100)
    #expect(await queue.stop(attempts: 3) == 1)
    #expect(await queue.pending.map(\.text) == ["s1"])
    await server.failing(0)
    #expect(await queue.flush())
    #expect(await server.texts == ["s1"])
  }

  @Test func aMeetingThatHasEndedIsNotRetriedForever() async {
    let tries = Recorder<[String]>()
    let queue = SegmentQueue(maxBatch: 2, sleep: noWait) { batch in
      tries.add(batch.map(\.text))
      if batch.first?.text == "s1" { throw LivingMapError.server(status: 400, message: "That meeting has ended.") }
    }
    for n in 1...3 { await queue.append(seg(n)) }
    #expect(await queue.flush())
    #expect(await queue.pending.isEmpty)
    #expect(await queue.rejected.map(\.text) == ["s1", "s2"])
    #expect(await queue.sentCount == 1)
    #expect(await queue.lastError == nil)
    #expect(await queue.stop(attempts: 3) == 0)
    #expect(tries.values == [["s1", "s2"], ["s3"]])
  }

  @Test func refusalsAreFinalButOutagesAreNot() {
    #expect(SegmentQueue.isRefusal(LivingMapError.server(status: 400, message: "That meeting has ended.")))
    #expect(SegmentQueue.isRefusal(LivingMapError.server(status: 404, message: "No meeting map with that name.")))
    #expect(SegmentQueue.isRefusal(LivingMapError.server(status: 503, message: "")) == false)
    #expect(SegmentQueue.isRefusal(LivingMapError.unreachable("down")) == false)
    #expect(SegmentQueue.isRefusal(URLError(.timedOut)) == false)
  }

  @Test func periodicLoopFlushesAndStopDrains() async throws {
    let server = FakeServer()
    let ticks = AsyncStream<Void>.makeStream()
    // Each loop wait ends when the test yields a tick, so the test drives time.
    let sleep: SegmentQueue.Sleep = { _ in
      var iterator = ticks.stream.makeAsyncIterator()
      _ = await iterator.next()
      try Task.checkCancellation()
    }
    let queue = SegmentQueue(sleep: sleep) { try await server.take($0) }
    await queue.start()
    await queue.append(seg(1))
    ticks.continuation.yield()
    try await waitUntil { await server.texts == ["s1"] }

    await queue.append(seg(2))
    // No tick: stop sends it anyway.
    #expect(await queue.stop(attempts: 1) == 0)
    #expect(await server.texts == ["s1", "s2"])
  }

  @Test func changesAreReportedForPersistence() async {
    let seen = Recorder<[String]>()
    let queue = SegmentQueue(sleep: noWait, onChange: { seen.add($0.map(\.text)) }) { _ in }
    await queue.append(seg(1))
    await queue.append(contentsOf: [seg(2), seg(3)])
    await queue.flush()
    #expect(seen.values == [["s1"], ["s1", "s2", "s3"], []])
  }

  @Test func backoffDoublesUpToTheCap() {
    let backoff = Backoff(interval: .seconds(2), base: .seconds(1), maximum: .seconds(10))
    #expect(backoff.delay(afterFailures: 0) == .seconds(2))
    #expect(backoff.delay(afterFailures: 1) == .seconds(1))
    #expect(backoff.delay(afterFailures: 2) == .seconds(2))
    #expect(backoff.delay(afterFailures: 4) == .seconds(8))
    #expect(backoff.delay(afterFailures: 5) == .seconds(10))
    #expect(backoff.delay(afterFailures: 500) == .seconds(10))
  }
}

final class Recorder<T: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var items: [T] = []
  func add(_ item: T) { lock.withLock { items.append(item) } }
  var values: [T] { lock.withLock { items } }
}

func waitUntil(timeout: Duration = .seconds(2), _ condition: () async -> Bool) async throws {
  let clock = ContinuousClock()
  let deadline = clock.now + timeout
  while clock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("condition not met in time")
}
