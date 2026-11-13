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
  let transcriptWindow = TranscriptWindowController()
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

    guard await server.refresh() else {
      alert(Self.notRunning(server.config), Self.howToOpen)
      return
    }
    let client = server.client
    let meeting: MeetingStart
    do {
      meeting = try await client.startMeeting(title: nil, app: app, by: settings.yourName)
    } catch {
      alert("Could not start a meeting map", error.localizedDescription)
      return
    }
    settings.remember(RecentMeeting(name: meeting.name, title: meeting.title, date: Date()))
    if let url = server.config.absolute(meeting.href) { mapWindow.show(url: url, title: meeting.title) }

    let session = RecordingSession(meeting: meeting, app: app, client: client, pending: pendingStore)
    transcriptWindow.reset(title: meeting.title)
    session.onHeard = { [weak self] segment in self?.transcriptWindow.add(segment) }
    self.session = session
    uploader.activeName = meeting.name
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
    uploader.activeName = nil
    busy = false
    if left > 0 {
      note = "\(left) segment(s) wait for the server; they are kept and sent when it is back."
      await uploader.run()
    }
    updateStatusItem()
  }

  static func notRunning(_ config: ServerConfig) -> String {
    "Anur Living Map isn't running on \(config.hostAndPort)"
  }

  static let howToOpen = "Open it with /anur-living-map in Claude Code"

  /// A meeting's map, by name; the map redirects to sign-in the first time,
  /// and the web view keeps the sign-in.
  func openMap(name: String, title: String) {
    guard let url = server.config.mapPage(name: name) else { return }
    mapWindow.show(url: url, title: title)
  }

  /// The list of every map, for when there is no meeting of this app's yet.
  func openMapList() {
    guard let url = server.config.mapsPage else { return }
    mapWindow.show(url: url, title: "your maps")
  }

  func showImport() {
    importWindow.show { [weak self] title, text in
      guard let self else { return }
      let meeting = try await self.server.client.importTranscript(
        title: title, text: text, me: NSFullUserName(), by: self.settings.yourName)
      self.settings.remember(RecentMeeting(name: meeting.name, title: meeting.title, date: Date()))
      if let url = self.server.config.absolute(meeting.href) { self.mapWindow.show(url: url, title: meeting.title) }
    }
  }

  // MARK: - status item

  func updateStatusItem() {
    guard let button = statusItem?.button else { return }
    if let session {
      button.image = Brand.recording
      button.title = " " + Clock.elapsed(Date().timeIntervalSince(session.started))
    } else {
      button.image = Brand.menuBar
      button.title = busy ? " …" : ""
    }
    button.contentTintColor = nil
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
