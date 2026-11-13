import Foundation

/// Segments the server has not taken yet, kept on disk per meeting so quitting
/// (or a crash) while the server is down loses nothing: the next launch sends
/// them and ends the meeting.
public struct PendingStore: Sendable {
  public let folder: URL

  public init(folder: URL) { self.folder = folder }

  public static func `default`() -> PendingStore {
    let support =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
    return PendingStore(folder: support.appendingPathComponent("Living Map Recorder/pending", isDirectory: true))
  }

  public struct Entry: Codable, Equatable, Sendable {
    public var name: String
    /// True once recording stopped: the meeting still needs its `end` after the send.
    public var ended: Bool
    public var segments: [Segment]

    public init(name: String, ended: Bool, segments: [Segment]) {
      self.name = name
      self.ended = ended
      self.segments = segments
    }
  }

  /// Writes the entry, or removes it when it has nothing left to do.
  public func save(_ entry: Entry) {
    let file = fileURL(entry.name)
    if entry.segments.isEmpty && !entry.ended {
      try? FileManager.default.removeItem(at: file)
      return
    }
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try JSONEncoder().encode(entry).write(to: file, options: .atomic)
    } catch {
      // Best effort: the segments are still in memory and still being retried.
      NSLog("[recorder] could not save pending segments: \(error)")
    }
  }

  public func remove(name: String) {
    try? FileManager.default.removeItem(at: fileURL(name))
  }

  public func all() -> [Entry] {
    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: folder, includingPropertiesForKeys: nil)
    else { return [] }
    return files.filter { $0.pathExtension == "json" }.sorted { $0.path < $1.path }.compactMap {
      guard let data = try? Data(contentsOf: $0) else { return nil }
      return try? JSONDecoder().decode(Entry.self, from: data)
    }
  }

  func fileURL(_ name: String) -> URL {
    let safe = name.unicodeScalars.map {
      CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" ? String($0) : "_"
    }.joined()
    return folder.appendingPathComponent("\(safe).json")
  }
}
