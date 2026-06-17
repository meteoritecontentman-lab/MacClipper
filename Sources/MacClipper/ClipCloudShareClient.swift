import Foundation
import AVFoundation
import MiniCutEditor

enum ClipCloudShareError: LocalizedError {
    case missingFile
    case invalidResponse
    case serviceUnavailable
    case uploadFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingFile:
            return "MacClipper could not find the exported clip to upload."
        case .invalidResponse:
            return "MacClipper Cloud returned an invalid response."
        case .serviceUnavailable:
            return "MacClipper Cloud is unavailable right now."
        case .uploadFailed(let message):
            return message
        }
    }
}

struct ClipCloudShareClient {
    private static let defaultPurchasePortalURLString = "https://macclipper-ce502.web.app/buy-4k.html"
    private static let defaultAPIBaseURLString = "https://macclipper-ce502.web.app/api"
    private static let defaultUploadLimitBytes: Int64 = 200 * 1024 * 1024

    func uploadClip(
        fileURL: URL,
        clipName: String,
        orientation: MiniCutExportOrientation,
        appUUID: String,
        websiteUserID: String? = nil
    ) async throws -> URL {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw ClipCloudShareError.missingFile
        }

        let requestURL = try endpointURL()
        let preparedUpload = try await Self.prepareUpload(for: fileURL)
        defer { preparedUpload.cleanup() }

        let fileData = try Data(contentsOf: preparedUpload.fileURL)
        let boundary = "Boundary-\(UUID().uuidString)"
        let body = makeMultipartBody(
            boundary: boundary,
            fileData: fileData,
            fileURL: preparedUpload.fileURL,
            clipName: clipName,
            orientation: orientation,
            appUUID: appUUID,
            websiteUserID: websiteUserID
        )

        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClipCloudShareError.invalidResponse
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            if let errorPayload = try? JSONDecoder().decode(CloudShareErrorResponse.self, from: data) {
                let message = errorPayload.error.trimmingCharacters(in: .whitespacesAndNewlines)
                if !message.isEmpty {
                    throw ClipCloudShareError.uploadFailed(message)
                }
            }

            let responseText = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let responseText, !responseText.isEmpty {
                throw ClipCloudShareError.uploadFailed(responseText)
            }
            throw ClipCloudShareError.serviceUnavailable
        }

        let payload = try JSONDecoder().decode(CloudShareUploadResponse.self, from: data)
        guard let pageURL = URL(string: payload.share.pageURL) else {
            throw ClipCloudShareError.invalidResponse
        }

        return pageURL
    }

    private func endpointURL() throws -> URL {
        guard let apiBaseURL = Self.accountServiceAPIBaseURL() else {
            throw ClipCloudShareError.serviceUnavailable
        }

        return apiBaseURL.appendingPathComponent("shared-clips", isDirectory: false)
    }

    private static func accountServiceAPIBaseURL() -> URL? {
        if let configuredAPIBaseURL = configuredAPIBaseURL() {
            return configuredAPIBaseURL
        }

        guard let purchasePortalURL = purchasePortalURL(),
              let scheme = purchasePortalURL.scheme,
              let host = purchasePortalURL.host else {
            return nil
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = purchasePortalURL.port

        guard let baseURL = components.url else {
            return nil
        }

        return baseURL.appendingPathComponent("api", isDirectory: false)
    }

    private static func configuredAPIBaseURL() -> URL? {
        let configuredURL = ((Bundle.main.object(forInfoDictionaryKey: "MacClipperAPIBaseURL") as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedURLString = configuredURL.isEmpty ? defaultAPIBaseURLString : configuredURL
        return URL(string: resolvedURLString)
    }

    private static func purchasePortalURL() -> URL? {
        let configuredURL = (
            (Bundle.main.object(forInfoDictionaryKey: "MacClipperAccountPortalURL") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "MacClipperPurchasePortalURL") as? String)
            ?? ""
        )
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedURLString = configuredURL.isEmpty ? defaultPurchasePortalURLString : configuredURL
        return URL(string: resolvedURLString)
    }

    private static func prepareUpload(for fileURL: URL) async throws -> PreparedCloudUpload {
        let fileSize = fileSize(at: fileURL)
        guard fileSize > defaultUploadLimitBytes else {
            return PreparedCloudUpload(fileURL: fileURL, cleanup: {})
        }

        return try await makeCompressedUpload(from: fileURL, maxBytes: defaultUploadLimitBytes)
    }

    private static func makeCompressedUpload(from fileURL: URL, maxBytes: Int64) async throws -> PreparedCloudUpload {
        let asset = AVURLAsset(url: fileURL)
        let presets = [
            AVAssetExportPreset1280x720,
            AVAssetExportPresetMediumQuality,
            AVAssetExportPreset640x480,
            AVAssetExportPresetLowQuality
        ]

        let tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("MacClipperCloudUploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)

        var lastError: Error?

        for preset in presets {
            let outputURL = tempDirectory
                .appendingPathComponent("cloud-\(UUID().uuidString)")
                .appendingPathExtension("mp4")

            do {
                try await exportCompressedAsset(asset: asset, presetName: preset, outputURL: outputURL)
                let outputSize = fileSize(at: outputURL)

                if outputSize <= maxBytes {
                    return PreparedCloudUpload(
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
            throw ClipCloudShareError.uploadFailed("MacClipper could not prepare this clip for cloud upload: \(lastError.localizedDescription)")
        }

        throw ClipCloudShareError.uploadFailed("MacClipper could not shrink this clip enough for cloud upload.")
    }

    private static func exportCompressedAsset(asset: AVURLAsset, presetName: String, outputURL: URL) async throws {
        guard let exporter = AVAssetExportSession(asset: asset, presetName: presetName) else {
            throw ClipCloudShareError.uploadFailed("MacClipper could not create a cloud upload export session.")
        }

        guard exporter.supportedFileTypes.contains(.mp4) else {
            throw ClipCloudShareError.uploadFailed("MacClipper could not create an upload-friendly MP4 for cloud upload.")
        }

        exporter.shouldOptimizeForNetworkUse = true

        do {
            try await exporter.export(to: outputURL, as: .mp4)
        } catch {
            try? FileManager.default.removeItem(at: outputURL)
            throw error
        }
    }

    private static func fileSize(at url: URL) -> Int64 {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        return Int64(values?.fileSize ?? 0)
    }

    private func makeMultipartBody(
        boundary: String,
        fileData: Data,
        fileURL: URL,
        clipName: String,
        orientation: MiniCutExportOrientation,
        appUUID: String,
        websiteUserID: String?
    ) -> Data {
        var body = Data()

        appendField(named: "appUuid", value: appUUID, boundary: boundary, to: &body)
        if let websiteUserID, !websiteUserID.isEmpty {
            appendField(named: "websiteUserId", value: websiteUserID, boundary: boundary, to: &body)
        }
        appendField(named: "title", value: clipName, boundary: boundary, to: &body)
        appendField(named: "orientation", value: orientation.rawValue, boundary: boundary, to: &body)

        let mimeType = mimeType(for: fileURL.pathExtension)
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n")
        body.append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n")

        return body
    }

    private func appendField(named name: String, value: String, boundary: String, to body: inout Data) {
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        body.append(value)
        body.append("\r\n")
    }

    private func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "mp4":
            return "video/mp4"
        case "mov":
            return "video/quicktime"
        default:
            return "application/octet-stream"
        }
    }
}

private struct PreparedCloudUpload {
    let fileURL: URL
    let cleanup: () -> Void
}

private struct CloudShareUploadResponse: Decodable {
    struct Share: Decodable {
        let pageURL: String
    }

    let share: Share
}

private struct CloudShareErrorResponse: Decodable {
    let error: String
}

private extension Data {
    mutating func append(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}