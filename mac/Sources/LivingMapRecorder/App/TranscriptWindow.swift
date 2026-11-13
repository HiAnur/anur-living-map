import AppKit
import RecorderCore

/// What the recorder has heard in the current meeting, one finished sentence per line, as it is heard: proof the
/// words are being captured, before the map shows anything.
@MainActor
final class TranscriptWindowController {
  private var window: NSWindow?
  private var textView: NSTextView?
  private var lines: [String] = []
  private var title = "No meeting yet"

  /// A new meeting starts an empty transcript.
  func reset(title: String) {
    self.title = title
    lines = []
    window?.title = "Transcript — \(title)"
    textView?.string = ""
  }

  func add(_ segment: Segment) {
    let time = Date(timeIntervalSince1970: segment.start / 1000).formatted(date: .omitted, time: .standard)
    let line = "\(time)  \(segment.speaker == .you ? "You:   " : "Others:")  \(segment.text)"
    lines.append(line)
    append(line)
  }

  func show() {
    let window = self.window ?? makeWindow()
    window.title = "Transcript — \(title)"
    textView?.string = lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
    textView?.scrollToEndOfDocument(nil)
    NSApp.activate()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
  }

  private func append(_ line: String) {
    guard let textView, window?.isVisible == true else { return }
    // follow the newest line only when you were already at the bottom
    let atEnd = textView.visibleRect.maxY >= textView.bounds.maxY - 20
    textView.textStorage?.append(NSAttributedString(string: line + "\n", attributes: Self.attributes))
    if atEnd { textView.scrollToEndOfDocument(nil) }
  }

  private static let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
    .foregroundColor: NSColor.labelColor,
  ]

  private func makeWindow() -> NSWindow {
    let scroll = NSTextView.scrollableTextView()
    let text = scroll.documentView as! NSTextView
    text.isEditable = false
    text.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    text.textContainerInset = NSSize(width: 8, height: 8)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 420),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.contentView = scroll
    window.isReleasedWhenClosed = false
    window.setFrameAutosaveName("TranscriptWindow")
    if !window.setFrameUsingName("TranscriptWindow") { window.center() }
    self.window = window
    textView = text
    return window
  }
}
