import Foundation

/// A meeting this Mac recorded or imported, for the Recent meetings menu.
public struct RecentMeeting: Codable, Equatable, Sendable {
  /// The map's name; its page is `/<name>/`.
  public var name: String
  public var title: String
  public var date: Date

  public init(name: String, title: String, date: Date) {
    self.name = name
    self.title = title
    self.date = date
  }
}

/// The recorder's own settings, in UserDefaults. `serverURL` and `yourName` are
/// hidden: set them with `defaults write com.anur.living-map-recorder yourName Harshit`.
public final class RecorderSettings: @unchecked Sendable {
  public static let maxRecent = 10

  let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

  public var serverURL: String? {
    get { defaults.string(forKey: "serverURL") }
    set { defaults.set(newValue, forKey: "serverURL") }
  }

  /// Who is recording, sent as `by`: the map's chat pane is shown only to that
  /// person, so it must be your team sign-in name. Defaults to your first name.
  public var yourName: String {
    get {
      let set = defaults.string(forKey: "yourName")?.trimmingCharacters(in: .whitespaces) ?? ""
      return set.isEmpty ? Self.firstName(of: NSFullUserName()) : set
    }
    set { defaults.set(newValue, forKey: "yourName") }
  }

  /// The first word of a full name; the whole of it when it has no space.
  public static func firstName(of fullName: String) -> String {
    let words = fullName.split(whereSeparator: \.isWhitespace)
    return words.first.map(String.init) ?? fullName
  }

  /// Offer to record when a meeting starts (on unless turned off).
  public var detectMeetings: Bool {
    get { defaults.object(forKey: "detectMeetings") as? Bool ?? true }
    set { defaults.set(newValue, forKey: "detectMeetings") }
  }

  /// Record the other people through the Mac's sound as well as your microphone.
  public var captureSystemAudio: Bool {
    get { defaults.object(forKey: "captureSystemAudio") as? Bool ?? true }
    set { defaults.set(newValue, forKey: "captureSystemAudio") }
  }

  public var recent: [RecentMeeting] {
    get {
      guard let data = defaults.data(forKey: "recentMaps") else { return [] }
      return (try? JSONDecoder().decode([RecentMeeting].self, from: data)) ?? []
    }
    set {
      defaults.set(try? JSONEncoder().encode(newValue), forKey: "recentMaps")
    }
  }

  /// Puts a meeting first in the recent list, once, keeping the newest `maxRecent`.
  public func remember(_ meeting: RecentMeeting) {
    recent = Self.adding(meeting, to: recent)
  }

  public static func adding(_ meeting: RecentMeeting, to list: [RecentMeeting]) -> [RecentMeeting] {
    Array(([meeting] + list.filter { $0.name != meeting.name }).prefix(maxRecent))
  }
}

public enum Clock {
  /// `m:ss`, or `h:mm:ss` from an hour on, for the elapsed recording time.
  public static func elapsed(_ seconds: TimeInterval) -> String {
    let total = max(0, Int(seconds))
    let (h, m, s) = (total / 3600, total / 60 % 60, total % 60)
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
  }
}
