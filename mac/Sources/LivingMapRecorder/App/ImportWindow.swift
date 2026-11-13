import AppKit
import RecorderCore
import SwiftUI
import UniformTypeIdentifiers

/// "Import transcript…": paste a transcript, or choose a file (.txt, .md, .vtt,
/// .srt), and the server maps it as a finished meeting.
@MainActor
final class ImportWindowController {
  private var window: NSWindow?
  private let model = ImportModel()

  /// `submit` sends the title (nil: the server names it) and text; it throws to
  /// show its error in the window.
  func show(submit: @escaping (String?, String) async throws -> Void) {
    model.submit = submit
    model.error = nil
    if window == nil {
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 620, height: 480),
        styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
      window.title = "Import transcript"
      window.isReleasedWhenClosed = false
      window.contentView = NSHostingView(
        rootView: ImportView(model: model, mark: Brand.mark, close: { [weak self] in self?.close() }))
      window.center()
      self.window = window
    }
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate()
  }

  func close() {
    window?.orderOut(nil)
    model.text = ""
    model.title = ""
    model.error = nil
  }
}

@MainActor
final class ImportModel: ObservableObject {
  @Published var title = ""
  @Published var text = ""
  @Published var error: String?
  @Published var busy = false
  var submit: ((String?, String) async throws -> Void)?

  func chooseFile() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.plainText, .text] + ["md", "vtt", "srt"].compactMap { UTType(filenameExtension: $0) }
    panel.allowsMultipleSelection = false
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      text = try TranscriptImport.read(file: url)
      if title.isEmpty { title = TranscriptImport.title(forFile: url) }
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  func send(then close: @escaping () -> Void) {
    let title = self.title.trimmingCharacters(in: .whitespaces)
    let body: String
    do {
      body = try TranscriptImport.clean(text)
    } catch {
      self.error = error.localizedDescription
      return
    }
    busy = true
    Task {
      defer { busy = false }
      do {
        try await submit?(title.isEmpty ? nil : title, body)
        close()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

private struct ImportView: View {
  @ObservedObject var model: ImportModel
  let mark: NSImage?
  let close: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        if let mark {
          Image(nsImage: mark).resizable().frame(width: 28, height: 28)
        }
        TextField("Title", text: $model.title)
          .textFieldStyle(.roundedBorder)
      }
      Text("Paste a meeting transcript (for example from Wispr Flow notes), or choose a file.")
        .font(.callout)
        .foregroundStyle(.secondary)
      TextEditor(text: $model.text)
        .font(.system(.body, design: .monospaced))
        .border(.separator)
      if let error = model.error {
        Text(error).foregroundStyle(.red).font(.callout)
      }
      HStack {
        Button("Choose file…") { model.chooseFile() }
        Spacer()
        Button("Cancel", action: close)
          .keyboardShortcut(.cancelAction)
        Button(model.busy ? "Importing…" : "Import") { model.send(then: close) }
          .keyboardShortcut(.defaultAction)
          .disabled(model.busy || model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .padding(16)
    .frame(minWidth: 480, minHeight: 360)
  }
}
