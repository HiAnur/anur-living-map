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
      entry.representedObject = meeting.name
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
    switch server.state {
    case .up:
      menu.addItem(disabled("Anur Living Map: running on \(server.config.hostAndPort)"))
    case .down, .unknown:
      menu.addItem(disabled(Self.notRunning(server.config)))
      menu.addItem(disabled(Self.howToOpen))
    }
    menu.addItem(disabled("Recording as \(settings.yourName)"))
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

  // The window comes forward straight from the click: macOS lets an app come
  // forward only while it handles one.
  @objc func openCurrentMap() {
    if let session {
      openMap(name: session.meeting.name, title: session.meeting.title)
    } else if let last = settings.recent.first {
      openMap(name: last.name, title: last.title)
    } else {
      openMapList()
    }
  }

  @objc func openRecent(_ sender: NSMenuItem) {
    guard let name = sender.representedObject as? String,
      let meeting = settings.recent.first(where: { $0.name == name })
    else { return }
    openMap(name: meeting.name, title: meeting.title)
  }

  @objc func importTranscript() { showImport() }

  @objc func toggleDetect() {
    settings.detectMeetings.toggle()
    if !settings.detectMeetings { prompt.hide() }
  }

  @objc func toggleSystemAudio() { settings.captureSystemAudio.toggle() }
}
