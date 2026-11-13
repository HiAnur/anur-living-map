import AppKit
import WebKit

/// The map, in a normal resizable window: a WKWebView on the local server,
/// signed in by the one-time link the server answered. The web view keeps its
/// cookies (the default data store), so the page stays signed in for reads.
@MainActor
final class MapWindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
  private var window: NSWindow?
  private var webView: WKWebView?
  private var serverHost: String?

  func show(url: URL, title: String) {
    serverHost = url.host
    present(title: title)
    webView?.load(URLRequest(url: url))
  }

  /// Brings the window to the front now. Called straight from a click too,
  /// before the server answers: macOS lets an app come forward only while it
  /// handles your click, and a window shown later stays behind the app you
  /// were in. `orderFrontRegardless` covers the times activation is refused.
  func present(title: String) {
    let window = self.window ?? makeWindow()
    window.title = "Living Map — \(title)"
    NSApp.activate()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
  }

  var isVisible: Bool { window?.isVisible ?? false }

  private func makeWindow() -> NSWindow {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsMagnification = true
    // a map opened from the list goes back to it with a two-finger swipe
    web.allowsBackForwardNavigationGestures = true

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.contentView = web
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.setFrameAutosaveName("LivingMapWindow")
    if !window.setFrameUsingName("LivingMapWindow") { window.center() }
    self.window = window
    self.webView = web
    return window
  }

  // Links to anything but the map's own server open in the browser.
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    if let url = action.request.url, let host = url.host, host != serverHost,
      action.navigationType == .linkActivated
    {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  // `target=_blank` and window.open: a page of the map's own server (a map
  // picked from the list) opens here, where you are signed in; anything else
  // in the browser.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard let url = action.request.url else { return nil }
    if url.host == serverHost {
      webView.load(URLRequest(url: url))
    } else {
      NSWorkspace.shared.open(url)
    }
    return nil
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    log("map page: \(error.localizedDescription)")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    log("map page did not load: \(error.localizedDescription)")
    webView.loadHTMLString(
      "<body style='font:15px -apple-system;padding:40px;color:#555'>The map did not load: \(error.localizedDescription).<br>Is the Living Map server running?</body>",
      baseURL: nil)
  }
}
