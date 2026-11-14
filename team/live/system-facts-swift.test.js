import { describe, expect, it } from 'vitest';

import { repo } from './system.harness.js';
import { readRepo } from './system-facts.js';
import { swiftFacts } from './system-facts-swift.js';
import { linkRepos } from './system-links.js';

// A Swift package and an Apple app, read as text: the package, its targets, the app's Info.plist and entitlements,
// and the addresses and API paths its source names.

const PACKAGE = `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Recorder",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "Recorder", targets: ["Recorder"]),
  ],
  dependencies: [
    // the updater
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
    .package(url: "https://github.com/apple/swift-log.git", from: "1.5.0"),
  ],
  targets: [
    .target(name: "Core"),
    .executableTarget(
      name: "Recorder",
      dependencies: ["Core", .product(name: "Sparkle", package: "Sparkle")]
    ),
    .testTarget(name: "CoreTests", dependencies: ["Core"]),
  ]
)
`;
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.recorder</string>
  <key>CFBundleName</key>
  <string>Recorder</string>
  <!-- <key>CFBundleDisplayName</key><string>Not this</string> -->
  <key>LSUIElement</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>To hear you.</string>
  <key>SUFeedURL</key>
  <string>https://releases.example.com/updates/appcast.xml</string>
</dict>
</plist>
`;
const CLIENT = `import Foundation

/// Talks to the server.
public struct Client {
  static let base = URL(string: "http://localhost:4323")!

  func version() async throws -> Data {
    let url = base.appendingPathComponent("/api/version")
    return try await URLSession.shared.data(from: url).0
  }

  func send(_ name: String) async throws {
    try await post("/api/meetings/\\(name)/segments", Body())
  }

  func remove(_ name: String) async throws {
    var request = URLRequest(url: base.appendingPathComponent("/api/items/\\(name)"))
    request.httpMethod = "DELETE"
    // "/api/commented-out" is not a call
  }
}
`;
const mac = () => repo('recorder-mac', {
  'Package.swift': PACKAGE,
  'Resources/Info.plist': PLIST,
  'Resources/Recorder.entitlements': '<plist><dict>\n  <key>com.apple.security.device.audio-input</key>\n  <true/>\n  <key>com.apple.security.app-sandbox</key>\n  <false/>\n</dict></plist>\n',
  'Sources/Core/Client.swift': CLIENT,
  'Tests/CoreTests/ClientTests.swift': 'let u = "https://test-only.example.com"\nlet p = "/api/only-in-tests"\n',
  'App.xcodeproj/project.pbxproj': '\t\tAA /* Recorder */ = {\n\t\t\tisa = PBXNativeTarget;\n\t\t\tname = Recorder;\n\t\t\tproductType = "com.apple.product-type.application";\n\t\t};\n\t\tBB /* RecorderTests */ = {\n\t\t\tisa = PBXNativeTarget;\n\t\t\tproductType = "com.apple.product-type.bundle.unit-test";\n\t\t};\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.recorder;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.recorderTests;\n',
});

describe('facts from a Swift package and an Apple app', () => {
  it('reads the package, its targets but its tests, and what each target depends on', () => {
    const root = mac();
    const facts = swiftFacts(root, ['Package.swift']);
    expect(facts[0]).toMatchObject({ kind: 'package', language: 'swift', name: 'Recorder', at: 'Package.swift:4', products: ['Recorder (executable)'], platforms: ['macOS 14'],
      dependencies: ['Sparkle', 'swift-log'], sources: ['https://github.com/sparkle-project/Sparkle exact 2.10.1', 'https://github.com/apple/swift-log.git from 1.5.0'] });
    expect(facts.filter((f) => f.kind === 'swift_target')).toEqual([
      expect.objectContaining({ name: 'Core', type: 'library', at: 'Package.swift:16' }),
      expect.objectContaining({ name: 'Recorder', type: 'executable', at: 'Package.swift:17', depends_on: ['Core', 'Sparkle'] }),
    ]);
  });
  it('reads an Xcode project\'s targets and bundle ids, leaving its tests out', () => {
    const facts = swiftFacts(mac(), ['App.xcodeproj/project.pbxproj']);
    expect(facts).toEqual([
      expect.objectContaining({ kind: 'package', name: 'App', bundle_ids: ['com.example.recorder'] }),
      expect.objectContaining({ kind: 'swift_target', name: 'Recorder', type: 'application', at: 'App.xcodeproj/project.pbxproj:1' }),
    ]);
  });
  it('reads what the app says about itself, and what its entitlements allow', () => {
    const facts = swiftFacts(mac(), ['Resources/Info.plist', 'Resources/Recorder.entitlements']);
    expect(facts[0]).toEqual({ id: '', kind: 'apple_app', at: 'Resources/Info.plist:5', name: 'Recorder', bundle_id: 'com.example.recorder', menu_bar: true,
      asks_for: ['microphone'], urls: { SUFeedURL: 'https://releases.example.com/updates/appcast.xml' } });
    expect(facts[1]).toMatchObject({ kind: 'entitlements', name: 'Recorder', allows: ['microphone'], at: 'Resources/Recorder.entitlements:2' });
  });
  it('reads the addresses Swift source names and the API paths it calls, with their methods', () => {
    const facts = swiftFacts(mac(), ['Sources/Core/Client.swift']);
    expect(facts.filter((f) => f.kind === 'api_call')).toEqual([
      expect.objectContaining({ method: 'GET', path: '/api/version', in_function: 'version', at: 'Sources/Core/Client.swift:8' }),
      expect.objectContaining({ method: 'POST', path: '/api/meetings/{}/segments', in_function: 'send' }),
      expect.objectContaining({ method: 'DELETE', path: '/api/items/{}', in_function: 'remove' }),
    ]);
    expect(facts.filter((f) => f.kind === 'url')).toEqual([expect.objectContaining({ url: 'http://localhost:4323', local: true, port: 4323, at: 'Sources/Core/Client.swift:5' })]);
  });
  it('reads a whole app repo, its tests left out, and links its calls to the routes a Node server serves', async () => {
    const app = await readRepo(mac());
    expect(app.kinds).toEqual(['apple-app']);
    expect(app.facts.some((f) => JSON.stringify(f).includes('only-in-tests') || JSON.stringify(f).includes('test-only'))).toBe(false);
    const server = await readRepo(repo('recorder-server', {
      'server.js': [
        "import http from 'node:http';",
        'http.createServer((req, res) => {',
        "  const url = new URL(req.url, 'http://x');",
        "  if (url.pathname === '/api/version') return res.end('1');",
        "  if (url.pathname.startsWith('/api/meetings') && req.method === 'POST') return res.end();",
        "  if (url.pathname === '/api/items' && req.method === 'GET') return res.end();",
        '});',
      ].join('\n'),
    }));
    expect(server.facts).toEqual([expect.objectContaining({ kind: 'server_routes', at: 'server.js:4', routes: ['ANY /api/version', 'GET /api/items', 'POST /api/meetings/*'] })]);
    const { links, unmatched } = linkRepos([app, server]);
    expect(links.filter((l) => l.kind === 'calls_route').map((l) => l.route)).toEqual(['GET /api/version', 'POST /api/meetings/{}/segments']);
    // a DELETE under /api/items is served by nothing: GET /api/items is not a prefix, nor that method
    expect(unmatched).toEqual([expect.objectContaining({ repo: 'recorder-mac', call: 'DELETE /api/items/{}' })]);
  });
});
