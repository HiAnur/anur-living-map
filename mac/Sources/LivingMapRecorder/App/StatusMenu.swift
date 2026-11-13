import AppKit
import RecorderCore

/// The status item's menu, rebuilt each time it opens so it shows the current state.
extension AppDelegate: NSMenuDelegate {
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    addRecordingItems(to: menu)
    menu.addItem(.separator())

    let recent = settings.recent
    // with no meeting of this app's yet, it opens the list of every map
    let hasMeeting = session != nil || !recent.isEmpty
    menu.addItem(item(hasMeeting ? "Open map" : "Open Living Map", #selector(openCurrentMap)))
    menu.addItem(item("Import transcript…", #selector(importTranscript)))
    let recentItem = NSMenuItem(title: "Recent meetings", action: nil, keyEquivalent: "")
    let submenu = NSMenu()
    for meeting in recent {
      let entry = item("\(meeting.title) — \(meeting.date.formatted(date: .abbreviated, time: .shortened))", #selector(openRecent(_:)))
      entry.representedObject = meeting.conv
      submenu.addItem(entry)
    }
    if recent.isEmpty { submenu.addItem(disabled("None yet")) }
    recentItem.submenu = submenu
    menu.addItem(recentItem)

    menu.addItem(.separator())
    addServerItems(to: menu)
    menu.addItem(.separator())

    let detect = item("Offer to record when a meeting starts", #selector(toggleDetect))
    detect.state = settings.detectMeetings ? .on : .off
    menu.addItem(detect)
    let others = item("Record others through the Mac's sound", #selector(toggleSystemAudio))
    others.state = settings.captureSystemAudio ? .on : .off
    menu.addItem(others)
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Quit Living Map Recorder", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
  }

  private func addRecordingItems(to menu: NSMenu) {
    if let session {
      let elapsed = Clock.elapsed(Date().timeIntervalSince(session.started))
      menu.addItem(item("Stop recording (\(elapsed))", #selector(stopClicked)))
      menu.addItem(disabled("“\(session.meeting.title)”"))
      menu.addItem(disabled("You: \(session.micStatus)"))
      var others = "Others: \(session.othersStatus)"
      if session.othersStatus.hasPrefix("listening"), !session.othersHeard {
        others += ", no sound yet (System Audio Recording may be off for this app)"
      }
      menu.addItem(disabled(others))
    } else if busy {
      menu.addItem(disabled("Working…"))
    } else {
      menu.addItem(item("Start Living Map Recorder", #selector(startClicked)))
    }
    if let note { menu.addItem(disabled(note)) }
    if uploader.waiting > 0 {
      menu.addItem(disabled("\(uploader.waiting) earlier meeting(s) waiting to send"))
    }
  }

  private func addServerItems(to menu: NSMenu) {
    let host = server.config.baseURL.host.map { "\($0):\(server.config.port)" } ?? server.config.baseURL.absoluteString
    switch server.state {
    case .up:
      menu.addItem(disabled("Server: running on \(host)"))
    case .starting:
      menu.addItem(disabled("Server: starting…"))
    case .down, .unknown:
      menu.addItem(disabled("Server not running on \(host)"))
      if server.appDir != nil {
        menu.addItem(item("Start server", #selector(startServerClicked)))
      } else {
        menu.addItem(disabled("Start it with: \(server.startCommand)"))
        menu.addItem(item("Choose Living Map folder…", #selector(chooseAppDir)))
      }
      menu.addItem(item("Copy start command", #selector(copyStartCommand)))
      if let error = server.lastStartError { menu.addItem(disabled(error)) }
    }
  }

  private func item(_ title: String, _ action: Selector) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.target = self
    return item
  }

  private func disabled(_ title: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.isEnabled = false
    return item
  }

  // MARK: - actions

  @objc func startClicked() {
    Task { await startRecording(app: nil) }
  }

  @objc func stopClicked() {
    Task { await stopRecording() }
  }

  @objc func openCurrentMap() {
    mapWindow.present(title: session?.meeting.title ?? settings.recent.first?.title ?? "your maps")
    if let session {
      Task { await openMap(conv: session.meeting.conv, title: session.meeting.title) }
    } else if let last = settings.recent.first {
      Task { await openMap(conv: last.conv, title: last.title) }
    } else {
      Task { await openMapList() }
    }
  }

  @objc func openRecent(_ sender: NSMenuItem) {
    guard let conv = sender.representedObject as? String,
      let meeting = settings.recent.first(where: { $0.conv == conv })
    else { return }
    mapWindow.present(title: meeting.title)
    Task { await openMap(conv: meeting.conv, title: meeting.title) }
  }

  @objc func importTranscript() { showImport() }

  @objc func startServerClicked() {
    Task { _ = await server.startServer() }
  }

  @objc func copyStartCommand() {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(server.startCommand, forType: .string)
  }

  @objc func chooseAppDir() {
    NSApp.activate()
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.message = "Choose the Living Map folder (the one holding skill/start.ts)."
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let script = url.appendingPathComponent(AppDirResolver.startScript).path
    if FileManager.default.fileExists(atPath: script) {
      settings.appDir = url.path
    } else {
      alert("That is not a Living Map folder", "It has no \(AppDirResolver.startScript).")
    }
  }

  @objc func toggleDetect() {
    settings.detectMeetings.toggle()
    if !settings.detectMeetings { prompt.hide() }
  }

  @objc func toggleSystemAudio() { settings.captureSystemAudio.toggle() }
}
