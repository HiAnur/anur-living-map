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
    let window = self.window ?? makeWindow()
    window.title = "Living Map — \(title)"
    webView?.load(URLRequest(url: url))
    window.makeKeyAndOrderFront(nil)
    NSApp.activate()
  }

  var isVisible: Bool { window?.isVisible ?? false }

  private func makeWindow() -> NSWindow {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsMagnification = true

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

  // `target=_blank` and window.open: the browser, not a second web view.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
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
