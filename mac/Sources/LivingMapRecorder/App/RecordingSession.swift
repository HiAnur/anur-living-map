import AVFoundation
import Foundation
import RecorderCore

/// One meeting being recorded: your mic and (best effort) the Mac's sound, each
/// with its own transcriber, feeding one segment queue that streams to the server.
@MainActor
final class RecordingSession {
  let meeting: MeetingStart
  let app: String?
  let started = Date()
  private(set) var micStatus = "starting…"
  private(set) var othersStatus = "starting…"

  let queue: SegmentQueue
  private let client: LivingMapClient
  private let pending: PendingStore
  private var mic: MicCapture?
  private var micTranscriber: LiveTranscriber?
  private var system: AnyObject?
  private var systemTranscriber: LiveTranscriber?
  private var feeds: [TimedFeed] = []

  init(meeting: MeetingStart, app: String?, client: LivingMapClient, pending: PendingStore) {
    self.meeting = meeting
    self.app = app
    self.client = client
    self.pending = pending
    let name = meeting.name
    queue = SegmentQueue(
      onChange: { segments in pending.save(.init(name: name, ended: false, segments: segments)) },
      send: { batch in try await client.sendSegments(name: name, batch) })
  }

  /// Starts both sources. The mic must work; the Mac's sound is best effort.
  func start(captureSystemAudio: Bool) async {
    await queue.start()
    await startMic()
    if captureSystemAudio {
      await startSystemAudio()
    } else {
      othersStatus = "off (turned off in the menu)"
    }
  }

  /// Stops the sources, waits for the last words, then sends everything and
  /// ends the meeting. Returns how many segments could not be sent yet; those
  /// stay on disk for the uploader.
  func stop() async -> Int {
    mic?.stop()
    mic = nil
    if #available(macOS 14.2, *) { (system as? SystemAudioCapture)?.stop() }
    system = nil
    await micTranscriber?.finish()
    await systemTranscriber?.finish()
    for feed in feeds { await feed.close() }
    micStatus = "stopped"
    othersStatus = "stopped"

    let left = await queue.stop(attempts: 3)
    let name = meeting.name
    let rejected = await queue.rejected.count
    if rejected > 0 { log("\(name) refused \(rejected) segment(s): \(await queue.lastError ?? "")") }
    if left == 0 {
      do {
        try await client.endMeeting(name: name)
        pending.remove(name: name)
        return 0
      } catch {
        log("ending \(name) failed: \(error.localizedDescription)")
        // Already ended, or the map is gone: nothing left to do for it.
        if SegmentQueue.isRefusal(error) {
          pending.remove(name: name)
          return 0
        }
      }
    }
    pending.save(.init(name: name, ended: true, segments: await queue.pending))
    return left
  }

  var othersHeard: Bool {
    if #available(macOS 14.2, *) { return (system as? SystemAudioCapture)?.heardSound ?? false }
    return false
  }

  private func startMic() async {
    guard await MicCapture.requestAccess() else {
      micStatus = "not allowed (System Settings > Privacy & Security > Microphone)"
      return
    }
    let transcriber = await Transcribers.make()
    let feed = TimedFeed(speaker: .you, queue: queue)
    feeds.append(feed)
    do {
      try await transcriber.start(onText: feed.heard)
      let capture = MicCapture()
      try capture.start { buffer in
        feed.markStart()
        transcriber.append(buffer)
      }
      mic = capture
      micTranscriber = transcriber
      micStatus = "transcribing (\(transcriber.engineName))"
    } catch {
      micStatus = "failed: \(error.localizedDescription)"
      log("mic: \(error.localizedDescription)")
    }
  }

  private func startSystemAudio() async {
    guard #available(macOS 14.2, *) else {
      othersStatus = "not captured (needs macOS 14.2)"
      return
    }
    let transcriber = await Transcribers.make()
    let feed = TimedFeed(speaker: .others, queue: queue)
    feeds.append(feed)
    do {
      try await transcriber.start(onText: feed.heard)
      let capture = SystemAudioCapture()
      system = capture
      systemTranscriber = transcriber
      othersStatus = "waiting for System Audio Recording permission…"
      // The first start blocks until you answer the permission prompt, so it
      // runs off the main thread; the mic is already recording meanwhile.
      try await Task.detached {
        try capture.start { buffer in
          feed.markStart()
          transcriber.append(buffer)
        }
      }.value
      if system === capture {
        othersStatus = "listening to the Mac's sound (\(transcriber.engineName))"
      }
    } catch {
      othersStatus = "not captured: \(error.localizedDescription)"
      log("system audio: \(error.localizedDescription)")
      await transcriber.finish()
    }
  }
}

/// Times a source's text from when its first buffer arrived, and queues it in
/// the order it was heard.
final class TimedFeed: @unchecked Sendable {
  let speaker: Speaker
  private let lock = NSLock()
  private var origin: Date?
  private let input: AsyncStream<Segment>.Continuation
  private let consumer: Task<Void, Never>

  init(speaker: Speaker, queue: SegmentQueue) {
    self.speaker = speaker
    let (stream, input) = AsyncStream<Segment>.makeStream()
    self.input = input
    consumer = Task {
      for await segment in stream { await queue.append(segment) }
    }
  }

  func markStart() {
    lock.withLock { if origin == nil { origin = Date() } }
  }

  var heard: @Sendable (HeardText) -> Void {
    { [self] text in
      let origin = lock.withLock { self.origin ?? Date() }
      input.yield(
        Segment(text: text.text, speaker: speaker, origin: origin, startSeconds: text.start, endSeconds: text.end))
    }
  }

  /// Waits until everything heard so far is in the queue.
  func close() async {
    input.finish()
    await consumer.value
  }
}
