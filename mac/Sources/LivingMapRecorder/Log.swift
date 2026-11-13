import Foundation
import os

private let logger = Logger(subsystem: "com.anur.living-map-recorder", category: "recorder")

/// Logs to the unified log (Console.app, `log stream --process LivingMapRecorder`) and to stderr.
func log(_ message: String) {
  logger.notice("\(message, privacy: .public)")
  FileHandle.standardError.write(Data("[recorder] \(message)\n".utf8))
}
