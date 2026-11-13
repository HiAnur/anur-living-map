// swift-tools-version: 6.0
import Foundation
import PackageDescription

let infoPlist = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  .appendingPathComponent("Resources/Info.plist").path

let package = Package(
  name: "LivingMapRecorder",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "LivingMapRecorder", targets: ["LivingMapRecorder"])
  ],
  targets: [
    // Everything that can be tested without a microphone, a screen or a server.
    .target(name: "RecorderCore"),
    // AppKit, CoreAudio and Speech: the menu-bar app and its --transcribe-file mode.
    // Swift 5 mode: the audio callbacks and AppKit delegates are not yet worth
    // annotating for strict concurrency in a prototype.
    .executableTarget(
      name: "LivingMapRecorder",
      dependencies: ["RecorderCore"],
      swiftSettings: [.swiftLanguageMode(.v5)],
      linkerSettings: [
        // The bare binary carries the app's Info.plist too, so --transcribe-file
        // run from a shell has the usage strings that Speech and TCC look for.
        .unsafeFlags([
          "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
          "-Xlinker", infoPlist,
        ])
      ]
    ),
    .testTarget(name: "RecorderCoreTests", dependencies: ["RecorderCore"]),
  ]
)
