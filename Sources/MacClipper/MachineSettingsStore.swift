import Foundation
import CryptoKit

struct PersistedAppSettings: Codable {
    var clipDuration: Double
    var startReplayBufferOnLaunch: Bool
    var includeMicrophone: Bool
    var selectedMicrophoneID: String?
    var captureSystemAudio: Bool
    var systemAudioLevel: Double?
    var microphoneAudioLevel: Double?
    var showCursor: Bool
    var enableGameNotifications: Bool
    var captureResolutionPreset: CaptureResolutionPreset
    var videoQualityPreset: VideoQualityPreset
    var appUUID: String?
    var websiteUserID: String?
    var unlockedPaidFeatures: [String]
    var shortcutKey: String
    var useCommand: Bool
    var useShift: Bool
    var useOption: Bool
    var useControl: Bool
    var saveDirectoryPath: String
    var selectedCaptureDisplayID: String
    var discordWebhookURLString: String
    var base44Token: String?
    var automaticallyChecksForUpdates: Bool
    var checksForUpdatesOnLaunch: Bool?
    var captureDeviceProfiles: [String: CaptureDeviceSettingsProfile]
    var uploadedClipURLs: [String]
    var hasCompletedOnboarding: Bool
    var lastSeenLaunchSetupVersion: String?
    var hasAcknowledgedFourKProUnlock: Bool?
    var customVoiceCommandPhrase: String?
}

private struct PersistedAppSettingsEnvelope: Codable {
    let schemaVersion: Int
    let machineIdentifier: String?
    let savedAt: Date
    let settings: PersistedAppSettings
    let signature: String?
}

final class MachineSettingsStore {
    private static let schemaVersion = 1
    private static let settingsFileName = "settings.json"
    private static let hmacSecretSalt = "macclipper-secret-salt"

    let settingsFileURL: URL

    private let fileManager: FileManager
    private let settingsDirectoryURL: URL
    private let legacySettingsDirectoryURL: URL

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager

        let baseDirectory = Self.makeSettingsDirectoryURL(fileManager: fileManager)
        settingsDirectoryURL = baseDirectory
        legacySettingsDirectoryURL = baseDirectory.appendingPathComponent("MachineSettings", isDirectory: true)
        settingsFileURL = baseDirectory.appendingPathComponent(Self.settingsFileName, isDirectory: false)
    }

    func loadSettings() -> PersistedAppSettings? {
        if let data = try? Data(contentsOf: settingsFileURL),
           let envelope = try? JSONDecoder().decode(PersistedAppSettingsEnvelope.self, from: data) {
            var settings = envelope.settings
            if let signature = envelope.signature, !signature.isEmpty {
                if !verifySettingsSignature(data: data, signature: signature) {
                    settings.unlockedPaidFeatures = []
                }
            }
            return settings
        }

        return migrateLegacySettingsIfNeeded()
    }

    func saveSettings(_ settings: PersistedAppSettings) {
        do {
            try Self.ensureDirectoryExists(at: settingsDirectoryURL, fileManager: fileManager)

            let envelope = PersistedAppSettingsEnvelope(
                schemaVersion: Self.schemaVersion,
                machineIdentifier: MachineIdentityProvider.current()?.identifier,
                savedAt: Date(),
                settings: settings,
                signature: nil
            )

            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(envelope)
            let signature = computeSettingsSignature(data: data)
            let signedEnvelope = PersistedAppSettingsEnvelope(
                schemaVersion: Self.schemaVersion,
                machineIdentifier: MachineIdentityProvider.current()?.identifier,
                savedAt: Date(),
                settings: settings,
                signature: signature
            )
            let signedData = try encoder.encode(signedEnvelope)
            try signedData.write(to: settingsFileURL, options: .atomic)
        } catch {
            NSLog("MacClipper failed to save local settings: \(error.localizedDescription)")
        }
    }

    func updateSettings(_ mutate: (inout PersistedAppSettings) -> Void) {
        guard var settings = loadSettings() else { return }
        mutate(&settings)
        saveSettings(settings)
    }

    private static func makeSettingsDirectoryURL(fileManager: FileManager) -> URL {
        let appSupportDirectory = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support", isDirectory: true)

        let isDeveloperBuild = (Bundle.main.object(forInfoDictionaryKey: "MacClipperDeveloperMode") as? Bool) ?? false
        let bundleIdentifier = (Bundle.main.bundleIdentifier ?? "local.macclipper.app").lowercased()

        if isDeveloperBuild || bundleIdentifier != "local.macclipper.app" {
            let displayName = ((Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? "MacClipper")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let folderName = displayName.isEmpty ? "MacClipper Dev" : displayName

            return appSupportDirectory.appendingPathComponent(folderName, isDirectory: true)
        }

        return appSupportDirectory.appendingPathComponent("MacClipper", isDirectory: true)
    }

    private static func ensureDirectoryExists(at url: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
    }

    private func migrateLegacySettingsIfNeeded() -> PersistedAppSettings? {
        guard let legacySettings = loadLegacySettings() else { return nil }

        saveSettings(legacySettings)
        cleanupLegacySettingsFiles()
        return legacySettings
    }

    private func loadLegacySettings() -> PersistedAppSettings? {
        guard let legacyFileURL = try? fileManager
            .contentsOfDirectory(at: legacySettingsDirectoryURL, includingPropertiesForKeys: nil)
            .first(where: { $0.pathExtension.lowercased() == "json" }),
            let data = try? Data(contentsOf: legacyFileURL),
            let envelope = try? JSONDecoder().decode(PersistedAppSettingsEnvelope.self, from: data) else {
            return nil
        }

        return envelope.settings
    }

    private func cleanupLegacySettingsFiles() {
        guard let legacyFiles = try? fileManager.contentsOfDirectory(
            at: legacySettingsDirectoryURL,
            includingPropertiesForKeys: nil
        ) else {
            return
        }

        for fileURL in legacyFiles {
            try? fileManager.removeItem(at: fileURL)
        }

        try? fileManager.removeItem(at: legacySettingsDirectoryURL)
    }

    private func hmacKey() -> Data {
        let platformUUID = MachineIdentityProvider.current()?.identifier ?? "unknown"
        return Data("\(platformUUID)\(Self.hmacSecretSalt)".utf8)
    }

    private func computeSettingsSignature(data: Data) -> String {
        let key = SymmetricKey(data: hmacKey())
        let code = HMAC<SHA256>.authenticationCode(for: data, using: key)
        return Data(code).map { String(format: "%02x", $0) }.joined()
    }

    private func verifySettingsSignature(data: Data, signature: String) -> Bool {
        let key = SymmetricKey(data: hmacKey())
        let expectedCode = HMAC<SHA256>.authenticationCode(for: data, using: key)
        let expectedString = Data(expectedCode).map { String(format: "%02x", $0) }.joined()
        return signature == expectedString
    }
}