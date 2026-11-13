import AppKit
import SwiftUI

/// The small floating pill near the top of the screen that offers to record a
/// meeting. It never takes focus from the meeting app and hides itself after 20 s.
@MainActor
final class MeetingPrompt {
  private var panel: NSPanel?
  private var hideTimer: Timer?

  func show(app: String?, onStart: @escaping () -> Void) {
    hide()
    let view = PromptView(
      mark: Brand.mark,
      app: app,
      start: { [weak self] in
        self?.hide()
        onStart()
      },
      dismiss: { [weak self] in self?.hide() })
    let host = NSHostingView(rootView: view)
    host.frame.size = host.fittingSize

    let panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: host.fittingSize),
      styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
    panel.isFloatingPanel = true
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    panel.isMovableByWindowBackground = true
    panel.contentView = host

    if let screen = NSScreen.main {
      let visible = screen.visibleFrame
      panel.setFrameOrigin(
        NSPoint(x: visible.midX - host.fittingSize.width / 2, y: visible.maxY - host.fittingSize.height - 12))
    }
    panel.orderFrontRegardless()
    self.panel = panel
    hideTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated { self?.hide() }
    }
  }

  func hide() {
    hideTimer?.invalidate()
    hideTimer = nil
    panel?.orderOut(nil)
    panel = nil
  }

  var isShown: Bool { panel != nil }
}

private struct PromptView: View {
  let mark: NSImage?
  let app: String?
  let start: () -> Void
  let dismiss: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      if let mark {
        Image(nsImage: mark)
          .resizable()
          .frame(width: 26, height: 26)
      } else {
        Image(systemName: "waveform.circle.fill")
          .font(.system(size: 22))
          .foregroundStyle(.tint)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(app.map { "Meeting in \($0)" } ?? "Meeting started")
          .font(.system(size: 13, weight: .semibold))
        Text("Map it live with Anur Living Map")
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      Button("Not now", action: dismiss)
        .buttonStyle(.bordered)
        .controlSize(.small)
      Button("Start Living Map Recorder", action: start)
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .keyboardShortcut(.defaultAction)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .frame(minWidth: 460)
    .background(.regularMaterial, in: Capsule())
    .overlay(Capsule().strokeBorder(.separator))
  }
}
