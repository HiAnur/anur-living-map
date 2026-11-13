import AppKit

/// The Anur mark, from the images build.sh makes out of docs/brand/ and puts in
/// the app's Resources. A bare debug binary has no bundle and falls back to SF Symbols.
@MainActor
enum Brand {
  /// The diamond alone, as a template, so it follows light and dark menu bars.
  static let menuBar: NSImage = {
    if let image = Bundle.main.image(forResource: "MenuBarIcon") {
      image.size = NSSize(width: 18, height: 18)
      image.isTemplate = true
      return image
    }
    let fallback = NSImage(systemSymbolName: "diamond.fill", accessibilityDescription: "Living Map Recorder")!
    fallback.isTemplate = true
    return fallback
  }()

  /// The same diamond in recording red, not a template.
  static let recording: NSImage = {
    let shape = menuBar
    let image = NSImage(size: shape.size, flipped: false) { rect in
      shape.draw(in: rect)
      NSColor.systemRed.set()
      rect.fill(using: .sourceAtop)
      return true
    }
    image.isTemplate = false
    image.accessibilityDescription = "Recording"
    return image
  }()

  /// The full mark (the light diamond on its dark rounded square), for the
  /// meeting prompt and the import window.
  static let mark: NSImage? = Bundle.main.image(forResource: "Mark")
}
