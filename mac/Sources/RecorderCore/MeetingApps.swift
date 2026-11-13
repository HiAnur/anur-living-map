import Foundation

/// Names the app behind a bundle id that is taking the microphone.
public enum MeetingApps {
  /// Bundle id prefixes of meeting apps, most specific first. Browsers hold the
  /// mic from a helper process (`com.google.Chrome.helper`), so prefixes match those too.
  static let known: [(prefix: String, name: String)] = [
    ("us.zoom.xos", "Zoom"),
    ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.microsoft.teams", "Microsoft Teams"),
    ("com.tinyspeck.slackmacgap", "Slack"),
    ("com.apple.FaceTime", "FaceTime"),
    ("com.apple.avconferenced", "FaceTime"),
    ("net.whatsapp.WhatsApp", "WhatsApp"),
    ("com.cisco.webexmeetingsapp", "Webex"),
    ("com.webex.meetingmanager", "Webex"),
    ("Cisco-Systems.Spark", "Webex"),
    ("com.hnc.Discord", "Discord"),
    ("com.skype.skype", "Skype"),
    ("com.around.Around", "Around"),
    ("co.teamport.around", "Around"),
    ("com.google.Chrome", "Google Chrome"),
    ("company.thebrowser.Browser", "Arc"),
    ("com.brave.Browser", "Brave"),
    ("com.microsoft.edgemac", "Microsoft Edge"),
    ("org.mozilla.firefox", "Firefox"),
    ("com.apple.Safari", "Safari"),
    ("com.apple.WebKit", "Safari"),
    ("com.operasoftware.Opera", "Opera"),
    ("com.vivaldi.Vivaldi", "Vivaldi"),
  ]

  /// Apps that take the mic for a moment and are never a meeting: dictation,
  /// Siri, this kind of recorder.
  static let ignoredPrefixes = [
    "com.apple.corespeech", "com.apple.assistant", "com.apple.siri", "com.apple.SpeechRecognitionCore",
    "com.apple.dictation", "com.apple.DictationIM", "com.apple.speech", "com.apple.accessibility",
    "com.apple.controlcenter", "com.apple.audio", "com.apple.CoreSpeech",
    "com.electron.wispr-flow", "com.wispr", "ai.wispr", "com.anur.living-map-recorder",
  ]

  public static func name(forBundleID id: String) -> String? {
    known.first { id == $0.prefix || id.hasPrefix($0.prefix + ".") }?.name
  }

  public static func isIgnored(_ id: String) -> Bool {
    let lower = id.lowercased()
    return ignoredPrefixes.contains { lower.hasPrefix($0.lowercased()) }
  }

  /// The name to show for a set of bundle ids taking input: a dedicated meeting
  /// app over a browser, a browser over an unknown app.
  public static func pick(_ ids: [String]) -> String? {
    let named = ids.compactMap { id in name(forBundleID: id).map { (id, $0) } }
    if let best = named.min(by: { rank($0.1) < rank($1.1) }) { return best.1 }
    return nil
  }

  private static let browsers: Set<String> = [
    "Google Chrome", "Arc", "Brave", "Microsoft Edge", "Firefox", "Safari", "Opera", "Vivaldi",
  ]

  private static func rank(_ name: String) -> Int { browsers.contains(name) ? 1 : 0 }
}
