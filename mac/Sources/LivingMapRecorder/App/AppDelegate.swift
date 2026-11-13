import AppKit
import RecorderCore

/// The menu-bar app: watches for meetings, starts and stops recordings, and
/// opens maps. The menu itself is built in StatusMenu.swift.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let settings = RecorderSettings()
  lazy var server = ServerWatch(settings: settings)
  let pendingStore = PendingStore.default()
  lazy var uploader = PendingUploader(store: pendingStore) { [unowned self] in self.server.client }
  let mapWindow = MapWindowController()
  let importWindow = ImportWindowController()
  let prompt = MeetingPrompt()

  var statusItem: NSStatusItem!
  var session: RecordingSession?
  var busy = false
  var note: String?
  private var policy = MeetingPolicy(ownPID: getpid())
  private var meetingTimer: Timer?
  private var clockTimer: Timer?

  func applicationDidFinishLaunching(_ notification: Notification) {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    menu.delegate = self
    statusItem.menu = menu
    updateStatusItem()

    server.onChange = { [weak self] in self?.updateStatusItem() }
    server.watch()
    uploader.start()
    meetingTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.checkForMeeting() }
    }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard session != nil else { return .terminateNow }
    Task {
      await stopRecording()
      sender.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }

  // MARK: - meetings

  private func checkForMeeting() {
    guard settings.detectMeetings else { return }
    let action = policy.update(signal: CA.meetingSignal(), isRecording: session != nil || busy, now: Date())
    switch action {
    case .prompt(let app):
      log("meeting detected\(app.map { " in \($0)" } ?? "")")
      prompt.show(app: app) { [weak self] in
        Task { await self?.startRecording(app: app) }
      }
    case .dismiss:
      prompt.hide()
    case .none:
      break
    }
  }

  func startRecording(app: String?) async {
    guard session == nil, !busy else { return }
    busy = true
    note = nil
    prompt.hide()
    updateStatusItem()
    defer {
      busy = false
      updateStatusItem()
    }

    if !(await server.refresh()) {
      guard server.appDir != nil, await server.startServer() else {
        alert(
          "The Living Map server is not running",
          "Start it, then try again:\n\n\(server.startCommand)" + (server.lastStartError.map { "\n\n\($0)" } ?? ""))
        return
      }
    }
    let client = server.client
    let meeting: MeetingStart
    do {
      meeting = try await client.startMeeting(title: nil, app: app)
    } catch {
      alert("Could not start a meeting map", error.localizedDescription)
      return
    }
    settings.remember(RecentMeeting(conv: meeting.conv, title: meeting.title, date: Date()))
    if let url = server.config.absolute(meeting.url) { mapWindow.show(url: url, title: meeting.title) }

    let session = RecordingSession(meeting: meeting, app: app, client: client, pending: pendingStore)
    self.session = session
    uploader.activeConv = meeting.conv
    await session.start(captureSystemAudio: settings.captureSystemAudio)
    let clock = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.updateStatusItem() }
    }
    RunLoop.main.add(clock, forMode: .common)
    clockTimer = clock
  }

  func stopRecording() async {
    guard let session, !busy else { return }
    busy = true
    clockTimer?.invalidate()
    clockTimer = nil
    updateStatusItem()
    let left = await session.stop()
    self.session = nil
    uploader.activeConv = nil
    busy = false
    if left > 0 {
      note = "\(left) segment(s) wait for the server; they are kept and sent when it is back."
      await uploader.run()
    }
    updateStatusItem()
  }

  func openMap(conv: String, title: String) async {
    do {
      let path = try await server.client.openMeeting(conv: conv)
      guard let url = server.config.absolute(path) else { return }
      mapWindow.show(url: url, title: title)
    } catch {
      alert("Could not open the map", error.localizedDescription)
    }
  }

  func showImport() {
    importWindow.show { [weak self] title, text in
      guard let self else { return }
      let meeting = try await self.server.client.importTranscript(
        title: title, text: text, me: NSFullUserName())
      self.settings.remember(RecentMeeting(conv: meeting.conv, title: meeting.title, date: Date()))
      if let url = self.server.config.absolute(meeting.url) { self.mapWindow.show(url: url, title: meeting.title) }
    }
  }

  // MARK: - status item

  func updateStatusItem() {
    guard let button = statusItem?.button else { return }
    if let session {
      button.image = NSImage(systemSymbolName: "record.circle.fill", accessibilityDescription: "Recording")
      button.contentTintColor = .systemRed
      button.title = " " + Clock.elapsed(Date().timeIntervalSince(session.started))
    } else {
      button.image = NSImage(
        systemSymbolName: busy ? "ellipsis.circle" : "point.3.connected.trianglepath.dotted",
        accessibilityDescription: "Living Map Recorder")
      button.contentTintColor = nil
      button.title = ""
    }
    button.imagePosition = .imageLeading
  }

  func alert(_ title: String, _ message: String) {
    NSApp.activate()
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message
    alert.runModal()
  }
}
