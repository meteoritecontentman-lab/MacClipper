import Foundation

final class AppLogger: @unchecked Sendable {
    static let shared = AppLogger()

    let logDirectoryURL: URL
    let logFileURL: URL
    private let legacyCaptureLogFileURL: URL
    private let legacyReplayLogFileURL: URL

    private let queue = DispatchQueue(label: "MacClipper.logger")
    private let formatter = ISO8601DateFormatter()
    private let fileManager = FileManager.default

    private init() {
        let legacyLogDirectoryURL = Self.resolveLegacyLogDirectoryURL(fileManager: fileManager)
        logDirectoryURL = Self.resolveLogDirectoryURL(fileManager: fileManager)
        logFileURL = logDirectoryURL.appendingPathComponent("main.log", isDirectory: false)
        legacyCaptureLogFileURL = legacyLogDirectoryURL.appendingPathComponent("capture.log", isDirectory: false)
        legacyReplayLogFileURL = legacyLogDirectoryURL.appendingPathComponent("replay-buffer.log", isDirectory: false)
        formatter.formatOptions = [.withInternetDateTime]
        ensureLogDirectoryExists()
        log("Logger", "session started mainLog=\(logFileURL.path)")
    }

    func log(_ category: String, _ message: String) {
        queue.async {
            let line = "[\(self.formatter.string(from: Date()))] [\(category)] \(message)\n"
            self.append(line: line)
        }
    }

    func readLog(maxCharacters: Int = 120_000) -> String {
        queue.sync {
            ensureLogDirectoryExists()

            let resolvedData = [logFileURL, legacyCaptureLogFileURL, legacyReplayLogFileURL]
                .compactMap { $0 }
                .compactMap { url -> Data? in
                    guard let data = try? Data(contentsOf: url), !data.isEmpty else {
                        return nil
                    }

                    return data
                }
                .first

            guard let data = resolvedData else {
                return "No diagnostics logs yet. Try clipping again, then refresh Main-Logs."
            }

            let logText = String(decoding: data, as: UTF8.self)
            guard logText.count > maxCharacters else {
                return logText
            }

            return "[log truncated to last \(maxCharacters) characters]\n" + String(logText.suffix(maxCharacters))
        }
    }

    func clearLog() {
        queue.sync {
            try? fileManager.removeItem(at: logFileURL)
            try? fileManager.removeItem(at: legacyCaptureLogFileURL)
            try? fileManager.removeItem(at: legacyReplayLogFileURL)
        }
    }

    private func append(line: String) {
        ensureLogDirectoryExists()
        let data = Data(line.utf8)

        append(data: data, to: logFileURL)
    }

    private func append(data: Data, to destinationURL: URL) {
        ensureDirectoryExists(at: destinationURL.deletingLastPathComponent())

        if fileManager.fileExists(atPath: destinationURL.path),
           let handle = try? FileHandle(forWritingTo: destinationURL) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
            try? handle.close()
            return
        }

        try? data.write(to: destinationURL, options: .atomic)
    }

    private func ensureLogDirectoryExists() {
        ensureDirectoryExists(at: logDirectoryURL)
    }

    private func ensureDirectoryExists(at url: URL) {
        guard !fileManager.fileExists(atPath: url.path) else { return }
        try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
    }

    private static func resolveLogDirectoryURL(fileManager: FileManager) -> URL {
        return fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/MacClipper/Main-Logs", isDirectory: true)
    }

    private static func resolveLegacyLogDirectoryURL(fileManager: FileManager) -> URL {
        return fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/MacClipper", isDirectory: true)
    }
}