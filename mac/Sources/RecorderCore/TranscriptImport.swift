import Foundation

/// Turns pasted text or a transcript file into what `POST /api/meetings/import` takes.
public enum TranscriptImport {
  public enum Problem: Error, Equatable, LocalizedError {
    case empty
    case unreadable(String)

    public var errorDescription: String? {
      switch self {
      case .empty: return "There is no transcript text to import."
      case .unreadable(let name): return "\(name) could not be read as text."
      }
    }
  }

  /// The title for a file: its name without the extension, else a dated default.
  public static func title(forFile url: URL) -> String {
    let name = url.deletingPathExtension().lastPathComponent.trimmingCharacters(in: .whitespaces)
    return name.isEmpty ? defaultTitle() : name
  }

  public static func defaultTitle(now: Date = Date(), locale: Locale = .current) -> String {
    let format = DateFormatter()
    format.locale = locale
    format.dateStyle = .medium
    format.timeStyle = .short
    return "Imported transcript, \(format.string(from: now))"
  }

  /// Reads a .txt, .md, .vtt or .srt file as plain transcript text.
  public static func read(file url: URL) throws -> String {
    guard let data = try? Data(contentsOf: url) else {
      throw Problem.unreadable(url.lastPathComponent)
    }
    let raw =
      String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16)
      ?? String(data: data, encoding: .isoLatin1)
    guard let raw else { throw Problem.unreadable(url.lastPathComponent) }
    let ext = url.pathExtension.lowercased()
    return try clean(ext == "vtt" || ext == "srt" ? stripCues(raw) : raw)
  }

  /// Trims the text and normalizes line endings; throws when nothing is left.
  public static func clean(_ text: String) throws -> String {
    let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw Problem.empty }
    return normalized
  }

  /// Drops WebVTT/SRT headers, cue numbers and timing lines, keeping what was said.
  public static func stripCues(_ text: String) -> String {
    let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    var kept: [String] = []
    for line in lines {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed == "WEBVTT" || trimmed.hasPrefix("WEBVTT ") || trimmed.hasPrefix("NOTE") { continue }
      if trimmed.contains("-->") { continue }
      if !trimmed.isEmpty, trimmed.allSatisfy(\.isNumber) { continue }
      if trimmed.isEmpty {
        if kept.last != "" { kept.append("") }
        continue
      }
      kept.append(trimmed)
    }
    return kept.joined(separator: "\n")
  }
}
