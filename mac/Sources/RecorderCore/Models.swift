import Foundation

/// Who said a segment: you through the microphone, or the others through the Mac's sound.
public enum Speaker: String, Codable, Sendable, CaseIterable {
  case you
  case others
}

/// One finalized piece of speech, as the server's segments route takes it.
/// `start` and `end` are epoch milliseconds.
public struct Segment: Codable, Equatable, Sendable {
  public var text: String
  public var speaker: Speaker
  public var start: Double
  public var end: Double

  public init(text: String, speaker: Speaker, start: Double, end: Double) {
    self.text = text
    self.speaker = speaker
    self.start = start
    self.end = end
  }

  /// A segment from text heard `startSeconds`…`endSeconds` into a stream that began at `origin`.
  public init(text: String, speaker: Speaker, origin: Date, startSeconds: Double, endSeconds: Double) {
    let base = origin.timeIntervalSince1970 * 1000
    self.init(
      text: text, speaker: speaker,
      start: (base + startSeconds * 1000).rounded(),
      end: (base + max(endSeconds, startSeconds) * 1000).rounded())
  }
}

/// What `POST /api/meetings` and `POST /api/meetings/import` answer.
public struct MeetingStart: Codable, Equatable, Sendable {
  /// The map's name, e.g. `launch-sync`.
  public var name: String
  public var title: String
  /// The map page, relative to the server: `/launch-sync/`.
  public var href: String

  public init(name: String, title: String, href: String) {
    self.name = name
    self.title = title
    self.href = href
  }
}

struct SegmentsBody: Encodable { var segments: [Segment] }
struct StartBody: Encodable {
  var title: String?
  var app: String?
  /// Who is recording, by their team sign-in name: the map's chat pane is theirs.
  var by: String
}
struct ImportBody: Encodable {
  var title: String?
  var text: String
  /// Your name as the transcript writes it: your lines are filed as yours.
  var me: String?
  var by: String
}
struct EmptyBody: Encodable {}
struct OkAnswer: Decodable { var ok: Bool? }
struct CountAnswer: Decodable { var ok: Bool?; var count: Int? }
struct ErrorAnswer: Decodable { var error: String }
