import Foundation
import AVFoundation

enum DiscordWebhookError: LocalizedError {
    case invalidWebhookURL
    case unsupportedWebhookHost
    case missingClipFile
    case clipTooLarge
    case uploadFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidWebhookURL:
            return "Public posting is not configured in this build."
        case .unsupportedWebhookHost:
            return "The locked public post target is invalid."
        case .missingClipFile:
            return "The clip file could not be found for public posting."
        case .clipTooLarge:
            return "The post target rejected the clip size, and MacClipper could not shrink it enough to send."
        case .uploadFailed(let message):
            return message
        }
    }
}

private struct PreparedDiscordUpload {
    let fileURL: URL
    let cleanup: () -> Void
}

struct DiscordWebhookUploadResult: Decodable {
    struct Attachment: Decodable {
        let url: String
    }

    let attachments: [Attachment]?
}

struct DiscordWebhookManager {
    private static let defaultUploadLimitBytes: Int64 = 24_000_000

    func testWebhook(webhookURLString: String) async throws {
        let webhookURL = try Self.validatedWebhookURL(from: webhookURLString)

        var request = URLRequest(url: webhookURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "content": "MacClipper test message: public clip posting is working."
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.validateDiscordResponse(data: data, response: response)
    }

    func uploadClip(fileURL: URL, webhookURLString: String, message: String) async throws -> URL? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw DiscordWebhookError.missingClipFile
        }

        let webhookURL = try Self.validatedWebhookURL(from: webhookURLString)
        let preparedUpload = try await Self.prepareUpload(for: fileURL)
        defer { preparedUpload.cleanup() }

        Self.log("upload starting file=\(preparedUpload.fileURL.lastPathComponent) size=\(Self.fileSize(at: preparedUpload.fileURL))")
        let (data, response) = try await Self.performUpload(
            fileURL: preparedUpload.fileURL,
            webhookURL: webhookURL,
            message: message
        )
        try Self.validateDiscordResponse(data: data, response: response)
        Self.log("upload completed file=\(preparedUpload.fileURL.lastPathComponent)")

        let uploadResult = try? JSONDecoder().decode(DiscordWebhookUploadResult.self, from: data)
        return uploadResult?.attachments?.first.flatMap { URL(string: $0.url) }
    }

    private static func prepareUpload(for fileURL: URL) async throws -> PreparedDiscordUpload {
        let fileSize = fileSize(at: fileURL)
        guard fileSize > defaultUploadLimitBytes else {
            return PreparedDiscordUpload(fileURL: fileURL, cleanup: {})
        }

        log("upload file exceeds default Discord limit; preparing compressed copy file=\(fileURL.lastPathComponent) size=\(fileSize)")
        return try await makeCompressedUpload(from: fileURL, maxBytes: defaultUploadLimitBytes)
    }

    private static func makeCompressedUpload(from fileURL: URL, maxBytes: Int64) async throws -> PreparedDiscordUpload {
        let asset = AVURLAsset(url: fileURL)
        let presets = [
            AVAssetExportPreset1280x720,
            AVAssetExportPresetMediumQuality,
            AVAssetExportPreset640x480,
            AVAssetExportPresetLowQuality
        ]

        let tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("MacClipperDiscordUploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)

        var lastError: Error?

        for preset in presets {
            let outputURL = tempDirectory
                .appendingPathComponent("discord-\(UUID().uuidString)")
                .appendingPathExtension("mp4")

            do {
                try await exportCompressedAsset(asset: asset, presetName: preset, outputURL: outputURL)
                let outputSize = fileSize(at: outputURL)
                log("compressed upload candidate preset=\(preset) size=\(outputSize) file=\(outputURL.lastPathComponent)")

                if outputSize <= maxBytes {
                    return PreparedDiscordUpload(
                        fileURL: outputURL,
                        cleanup: {
                            try? FileManager.default.removeItem(at: outputURL)
                        }
                    )
                }

                try? FileManager.default.removeItem(at: outputURL)
            } catch {
                lastError = error
                try? FileManager.default.removeItem(at: outputURL)
            }
        }

        if let lastError {
            throw DiscordWebhookError.uploadFailed("MacClipper could not prepare this clip for public posting: \(lastError.localizedDescription)")
        }

        throw DiscordWebhookError.clipTooLarge
    }

    private static func exportCompressedAsset(asset: AVURLAsset, presetName: String, outputURL: URL) async throws {
        guard let exporter = AVAssetExportSession(asset: asset, presetName: presetName) else {
            throw DiscordWebhookError.uploadFailed("MacClipper could not create a public-post export session.")
        }

        guard exporter.supportedFileTypes.contains(.mp4) else {
            throw DiscordWebhookError.uploadFailed("MacClipper could not create an upload-friendly MP4 for this clip.")
        }

        exporter.shouldOptimizeForNetworkUse = true

        do {
            try await exporter.export(to: outputURL, as: .mp4)
        } catch {
            try? FileManager.default.removeItem(at: outputURL)
            throw error
        }
    }

    private static func performUpload(fileURL: URL, webhookURL: URL, message: String) async throws -> (Data, URLResponse) {
        let boundary = "Boundary-\(UUID().uuidString)"
        let fileData = try Data(contentsOf: fileURL)
        let filename = fileURL.lastPathComponent
        let mimeType = Self.mimeType(for: fileURL.pathExtension)

        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"payload_json\"\r\n\r\n")
        body.append("{\"content\":\"\(Self.escapeJSONString(message))\"}\r\n")
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"files[0]\"; filename=\"\(filename)\"\r\n")
        body.append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n")

        var request = URLRequest(url: webhookURL)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        request.httpBody = body

        return try await URLSession.shared.data(for: request)
    }

    private static func validatedWebhookURL(from rawValue: String) throws -> URL {
        guard var webhookURL = URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = webhookURL.scheme?.lowercased(),
              scheme == "https" else {
            throw DiscordWebhookError.invalidWebhookURL
        }

        guard let host = webhookURL.host?.lowercased(), host.contains("discord.com") || host.contains("discordapp.com") else {
            throw DiscordWebhookError.unsupportedWebhookHost
        }

        if var components = URLComponents(url: webhookURL, resolvingAgainstBaseURL: false) {
            var queryItems = components.queryItems ?? []
            if !queryItems.contains(where: { $0.name == "wait" }) {
                queryItems.append(URLQueryItem(name: "wait", value: "true"))
            }
            components.queryItems = queryItems
            webhookURL = components.url ?? webhookURL
        }

        return webhookURL
    }

    private static func validateDiscordResponse(data: Data, response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DiscordWebhookError.uploadFailed("The public post target did not return a valid response.")
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            let responseText = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if httpResponse.statusCode == 413 || responseText?.localizedCaseInsensitiveContains("request entity too large") == true {
                throw DiscordWebhookError.clipTooLarge
            }
            let message = responseText?.isEmpty == false
                ? "Public post failed: \(responseText!)"
                : "Public post failed with status \(httpResponse.statusCode)."
            throw DiscordWebhookError.uploadFailed(message)
        }
    }

    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "mp4":
            return "video/mp4"
        case "mov":
            return "video/quicktime"
        case "m4v":
            return "video/x-m4v"
        default:
            return "application/octet-stream"
        }
    }

    private static func escapeJSONString(_ string: String) -> String {
        string
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
    }

    private static func fileSize(at url: URL) -> Int64 {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        return Int64(values?.fileSize ?? 0)
    }

    private static func log(_ message: String) {
        AppLogger.shared.log("Discord", message)
    }
}

private extension Data {
    mutating func append(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}
