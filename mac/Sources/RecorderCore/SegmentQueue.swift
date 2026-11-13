import Foundation

/// How long to wait before trying again after `failures` sends in a row failed.
public struct Backoff: Sendable, Equatable {
  public var interval: Duration
  public var base: Duration
  public var maximum: Duration

  public init(interval: Duration = .seconds(2), base: Duration = .seconds(2), maximum: Duration = .seconds(60)) {
    self.interval = interval
    self.base = base
    self.maximum = maximum
  }

  /// The regular flush interval while sends succeed, doubling from `base` up to `maximum` while they fail.
  public func delay(afterFailures failures: Int) -> Duration {
    guard failures > 0 else { return interval }
    let factor = 1 << min(failures - 1, 16)
    return min(base * factor, maximum)
  }
}

/// Holds finalized segments until the server has them. Segments go out in the
/// order they were added, in batches, one send at a time; a failed send keeps
/// its batch at the front for the next try, so nothing is dropped or reordered.
/// Only a refusal the server will not change its mind on (the meeting has
/// ended, the map is gone) moves a batch out, to `rejected`, instead of
/// retrying it forever.
public actor SegmentQueue {
  public typealias Send = @Sendable ([Segment]) async throws -> Void
  public typealias Sleep = @Sendable (Duration) async throws -> Void

  public private(set) var pending: [Segment] = []
  public private(set) var sentCount = 0
  public private(set) var failures = 0
  public private(set) var lastError: String?
  public private(set) var rejected: [Segment] = []

  private let send: Send
  private let isFinal: @Sendable (Error) -> Bool
  private let sleep: Sleep
  private let backoff: Backoff
  private let maxBatch: Int
  private let onChange: (@Sendable ([Segment]) -> Void)?
  private var sending = false
  private var waiting: [CheckedContinuation<Void, Never>] = []
  private var loop: Task<Void, Never>?

  public init(
    pending: [Segment] = [], maxBatch: Int = 100, backoff: Backoff = Backoff(),
    sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
    onChange: (@Sendable ([Segment]) -> Void)? = nil,
    isFinal: @escaping @Sendable (Error) -> Bool = SegmentQueue.isRefusal,
    send: @escaping Send
  ) {
    self.isFinal = isFinal
    self.pending = pending
    self.maxBatch = max(1, maxBatch)
    self.backoff = backoff
    self.sleep = sleep
    self.onChange = onChange
    self.send = send
  }

  public func append(_ segment: Segment) {
    pending.append(segment)
    onChange?(pending)
  }

  public func append(contentsOf segments: [Segment]) {
    guard !segments.isEmpty else { return }
    pending.append(contentsOf: segments)
    onChange?(pending)
  }

  /// Sends everything pending, a batch at a time. Waits for a send already
  /// under way rather than starting a second one beside it. True when nothing is left.
  @discardableResult
  public func flush() async -> Bool {
    // A lock handed from one flush to the next: the actor is re-entered at
    // every await, and two sends side by side could deliver a batch twice.
    if sending {
      await withCheckedContinuation { waiting.append($0) }
    } else {
      sending = true
    }
    let ok = await sendAll()
    if waiting.isEmpty { sending = false } else { waiting.removeFirst().resume() }
    return ok
  }

  /// Flushes every `backoff.interval`, waiting longer after failures, until `stop()`.
  public func start() {
    guard loop == nil else { return }
    loop = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        let wait = await self.backoff.delay(afterFailures: self.failures)
        do { try await self.sleep(wait) } catch { return }
        if Task.isCancelled { return }
        await self.flush()
      }
    }
  }

  /// Ends the periodic flush and sends what is left, trying up to `attempts`
  /// times with backoff. Returns how many segments are still not sent; they stay
  /// in `pending` for the caller to keep trying.
  @discardableResult
  public func stop(attempts: Int = 5) async -> Int {
    loop?.cancel()
    loop = nil
    for attempt in 0..<max(1, attempts) {
      if await flush() { return 0 }
      if attempt < attempts - 1 { try? await sleep(backoff.delay(afterFailures: failures)) }
    }
    return pending.count
  }

  /// A Living Map refusal that asking again will not change.
  public static let isRefusal: @Sendable (Error) -> Bool = { error in
    (error as? LivingMapError).map { !$0.isRetryable } ?? false
  }

  private func sendAll() async -> Bool {
    while !pending.isEmpty {
      let batch = Array(pending.prefix(maxBatch))
      do {
        try await send(batch)
      } catch {
        lastError = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        if isFinal(error) {
          pending.removeFirst(batch.count)
          rejected.append(contentsOf: batch)
          onChange?(pending)
          continue
        }
        failures += 1
        return false
      }
      // Segments appended during the send sit after this batch, so the front is still it.
      pending.removeFirst(batch.count)
      sentCount += batch.count
      failures = 0
      lastError = nil
      onChange?(pending)
    }
    return true
  }
}
