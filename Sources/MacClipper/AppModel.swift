// === Placeholders for missing types to unblock build ===
struct SavedClip: Identifiable, Equatable {
    let url: URL
    let createdAt: Date
    let sourceApp: ClipSourceApp?
    var id: URL { url }
    var fileSizeText: String {
        guard FileManager.default.fileExists(atPath: url.path) else {
            return "Deleted"
        }
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size = attrs?[.size] as? Int64 ?? 0
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: size)
    }
    static func == (lhs: SavedClip, rhs: SavedClip) -> Bool {
        lhs.url == rhs.url && lhs.createdAt == rhs.createdAt
    }
}
struct AppInstallationRegistrationPayload: Codable {
    let appUuid: String
    let machineIdentifier: String
    let machineName: String
    let machineModel: String
    let systemVersion: String
    let appVersion: String
    let buildVersion: String
    let ownerLocked: Bool
}

struct AppInstallationRegistrationSnapshot: Codable {
    let installation: Installation

    struct Installation: Codable {
        let appUuid: String
    }
}

struct ClipMetadata: Codable {
    let sourceApp: ClipSourceApp?
    let capturedAt: Date
    // Add more fields as needed
}

enum ClipLibraryLoader {
    static func loadSavedClips(from folderURL: URL, uploadedClipURLs: [URL]) -> [SavedClip] {
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(at: folderURL, includingPropertiesForKeys: [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else {
            return []
        }
        var clips: [SavedClip] = []
        for case let fileURL as URL in enumerator {
            guard let resourceValues = try? fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
                  resourceValues.isRegularFile == true else { continue }
            let ext = fileURL.pathExtension.lowercased()
            guard ext == "mp4" || ext == "mov" else { continue }
            guard let fileSize = resourceValues.fileSize, fileSize >= 1024 else { continue }
            let metadata = Self.loadMetadata(for: fileURL)
            let createdAt = metadata?.capturedAt ?? (try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
            clips.append(SavedClip(url: fileURL, createdAt: createdAt, sourceApp: metadata?.sourceApp))
        }
        clips.sort { $0.createdAt > $1.createdAt }
        return clips
    }

    static func loadMetadata(for videoURL: URL) -> ClipMetadata? {
        let metadataURL = videoURL.deletingPathExtension().appendingPathExtension("json")
        guard let data = try? Data(contentsOf: metadataURL) else { return nil }
        return try? JSONDecoder().decode(ClipMetadata.self, from: data)
    }

    static func metadataURL(for url: URL) -> URL {
        url.deletingPathExtension().appendingPathExtension("json")
    }
    static func makeSavedClip(from url: URL, fallbackCreatedAt: Date, sourceApp: ClipSourceApp?) -> SavedClip? {
        return SavedClip(url: url, createdAt: fallbackCreatedAt, sourceApp: sourceApp)
    }
}
// === End placeholders ===
// Minimal placeholder for missing types to unblock build

struct ClipSourceApp: Codable {
    let name: String
    let bundleIdentifier: String?
    var isDesktopCapture: Bool { name == "Desktop" }
}


import Foundation
import AppKit
import AVFoundation
import MiniCutEditor
import SwiftUI
import UserNotifications
// import Supabase

// Audio source selection for smarter capture
public enum AudioSourceSelection: String, Codable, CaseIterable, Identifiable {
    public var id: String { rawValue }
    case microphoneOnly
    case systemAudioOnly
    case both
}

struct CloudShareStatusSummary: Equatable {
    let clipPath: String
    let clipName: String
    let startedAt: Date
    let state: State

    enum State: Equatable {
        case processing
        case finishing
        case uploaded(sharedURL: URL)
        case failed(message: String)
        case needsWebsiteLink
    }
}



struct CaptureDisplayOption: Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String
}

struct MicrophoneOption: Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String

    var pickerLabel: String {
        detail.isEmpty ? title : "\(title) • \(detail)"
    }
}

struct PendingClipRequest: Identifiable {
    let id = UUID()
    let capturePoint: ReplayCapturePoint
    let duration: Int
    let sourceApp: ClipSourceApp?
    let suppressMicrophoneInExport: Bool
}


enum DiscordShareMode: Equatable {
    case channelUpload
    case directMessageHandoff
}

enum ClipEditorPresentationMode: Equatable {
    case edit
    case cloudShare
}



struct CaptureDeviceSettingsProfile: Codable {
    let clipDuration: Double
    let includeMicrophone: Bool
    let captureSystemAudio: Bool
    let systemAudioLevel: Double?
    let microphoneAudioLevel: Double?
    let showCursor: Bool
    let captureResolutionPreset: CaptureResolutionPreset
    let videoQualityPreset: VideoQualityPreset
}

@MainActor
final class AppModel: ObservableObject {
    private lazy var clipEditorWindowManager = ClipEditorWindowManager(model: self)
    @Published private(set) var isBackendConnected: Bool = false

    // MARK: - PRO Clip Editor Integration
    @Published var editingClip: SavedClip? = nil
    @Published var clipEditorPresentationMode: ClipEditorPresentationMode = .edit
    @Published var pendingEditorCloudShareClipURL: URL?

    func prepareClipEditorWindow(with clip: SavedClip? = nil) {
        if let clip {
            selectedClip = clip
            clipBeingEdited = clip
            editingClip = clip
        } else if let currentClip = clipBeingEdited ?? selectedClip ?? editingClip ?? clips.first {
            selectedClip = currentClip
            clipBeingEdited = currentClip
            editingClip = currentClip
        }

        clipEditorWindowManager.present()

        if clipEditorPresentationMode == .cloudShare {
            statusText = "Opened the MacClipper Cloud workspace."
        } else if hasUnlocked4KPro {
            statusText = "Opened MacClipper Editor."
        } else {
            statusText = "MacClipper Editor is open. Unlock MacClipper PRO to edit clips there."
        }
    }

    func openClipEditor(for clip: SavedClip) {
        clipEditorPresentationMode = .edit
        pendingEditorCloudShareClipURL = nil
        prepareClipEditorWindow(with: clip)
    }

    func openCloudShareWorkspace(for clip: SavedClip) {
        clipEditorPresentationMode = .cloudShare
        pendingEditorCloudShareClipURL = clip.url
        prepareClipEditorWindow(with: clip)
    }

    func consumePendingCloudShareRequest(for clipURL: URL) {
        guard pendingEditorCloudShareClipURL == clipURL else { return }
        pendingEditorCloudShareClipURL = nil
    }

    private static let lockedDiscordWebhookURL = "https://discord.com/api/webhooks/1499906346504683720/6YMO6RdiAT29M9o0GvZnIxC0Sj6ijRGozZCvT-Z5IxqlRBktZ8wOF7cV9fjRvfkEUxxQ"
    private static let captureDeviceProfilesKey = "captureDeviceProfiles"
    private static let defaultPurchasePortalURLString = "https://macclipper.co/support"

    @Published var statusText: String = "Capture ready"
    @Published var isRecording: Bool = false
    @Published var isBusy: Bool = false
    @Published var lastClipURL: URL?
    @Published var clips: [SavedClip] = []
    @Published var selectedClip: SavedClip?
    @Published var clipBeingEdited: SavedClip?

    @Published var clipDuration: Double
    @Published var startReplayBufferOnLaunch: Bool
    @Published var includeMicrophone: Bool
    @Published var selectedMicrophoneID: String
    @Published var captureSystemAudio: Bool
    @Published var systemAudioLevel: Double
    @Published var microphoneAudioLevel: Double
    @Published var showCursor: Bool
    @Published var enableGameNotifications: Bool
    @Published var captureResolutionPreset: CaptureResolutionPreset
    @Published var videoQualityPreset: VideoQualityPreset
    @Published var appUUID: String
    @Published var websiteUserID: String
    @Published var unlockedPaidFeatures: [String]
    @Published var shortcutKey: String
    @Published var useCommand: Bool
    @Published var useShift: Bool
    @Published var useOption: Bool
    @Published var useControl: Bool
    @Published var saveDirectoryPath: String
    @Published var selectedCaptureDisplayID: String
    @Published var discordWebhookURLString: String
    @Published var base44Token: String
    @Published var developerAccessToken: String
    @Published var developerStatusText: String = "Sign in to the private Firebase admin API to manage installs and account status."
    @Published var developerSearchText: String = ""
    @Published var developerInstallations: [DeveloperInstallationSummary] = []
    @Published var isDeveloperBusy: Bool = false
    @Published var diagnosticsLogText: String = ""
    @Published var diagnosticsLogStatusText: String = "Refresh to load the latest diagnostics log."
    @Published var isCloudConnected: Bool = false
    @Published var uploadedClipURLs: Set<String> = []
    @Published var cloudShareStatus: CloudShareStatusSummary?
    @Published var hasCompletedOnboarding: Bool
    @Published var shouldShowLaunchSetup: Bool = true

    let updater: UpdaterManager

    private let defaults = UserDefaults.standard
    private let settingsStore: MachineSettingsStore
    private let recorder = ReplayBufferRecorder()
    private let discordWebhookManager = DiscordWebhookManager()
    private let clipCloudShareClient = ClipCloudShareClient()
    // private let supabase = SupabaseClient(
    //     supabaseURL: URL(string: "https://ccnuqjmqmylergzatpua.supabase.co")!,
    //     supabaseKey: "sb_publishable_Rdcitk793uU54mzZFlwc-g_Gndh-orm"
    // )
    private let hotkeyManager = HotkeyManager()
    private let voiceCommandManager = VoiceCommandManager()
    private var notificationObservers: [NSObjectProtocol] = []
    private var pendingClipRequests: [PendingClipRequest] = []
    private var activeClipRequest: PendingClipRequest?
    private var isProcessingClipQueue = false
    private var hasResolvedInstallationIdentity = false
    private var activeCloudUploadPaths: Set<String> = []
    private var activeDiscordUploadPaths: Set<String> = []
    private var lastWarmupNotificationAt: Date?
    private var didAttemptInitialRecording = false
    private var isRecoveringRecorder = false
    private var shouldRetryAutomaticStart = false
    private var captureDeviceProfiles: [String: CaptureDeviceSettingsProfile] = [:]
    private var microphoneCaptureSuppressed = false
    private var automaticRearmTask: Task<Void, Never>?
    private var entitlementSyncTask: Task<Void, Never>?
    private var appInstallationRegistrationTask: Task<Void, Never>?
    private var hasShownBackendConnectionNotification = false
    private var isEntitlementSyncInFlight = false
    private var hasAppliedInitialEntitlementSnapshot = false
    private var hasAcknowledgedFourKProUnlock = false
    private var lastSeenLaunchSetupVersion: String?
    private var customVoiceCommandPhrase: String?
    private let defaultSaveDirectory: String

    init() {
        let defaults = UserDefaults.standard
        defaultSaveDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Movies/MacClipper", isDirectory: true)
            .path

        let settingsStore = MachineSettingsStore()
        let persistedSettings = Self.loadPersistedSettings(
            from: settingsStore,
            defaults: defaults,
            defaultSaveDirectory: defaultSaveDirectory
        )

        self.settingsStore = settingsStore
        updater = UpdaterManager(
            automaticallyChecksForUpdates: persistedSettings.automaticallyChecksForUpdates,
            checksForUpdatesOnLaunch: persistedSettings.checksForUpdatesOnLaunch ?? false,
            settingsStore: settingsStore
        )

        clipDuration = Self.normalizedClipDuration(persistedSettings.clipDuration)
        startReplayBufferOnLaunch = true
        includeMicrophone = persistedSettings.includeMicrophone
        selectedMicrophoneID = persistedSettings.selectedMicrophoneID ?? ""
        captureSystemAudio = persistedSettings.captureSystemAudio
        systemAudioLevel = Self.resolvedSystemAudioLevel(
            persistedLevel: persistedSettings.systemAudioLevel,
            persistedMicrophoneLevel: persistedSettings.microphoneAudioLevel
        )
        microphoneAudioLevel = Self.normalizedMicrophoneAudioLevel(persistedSettings.microphoneAudioLevel ?? 1.0)
        showCursor = persistedSettings.showCursor
        enableGameNotifications = persistedSettings.enableGameNotifications
        captureResolutionPreset = persistedSettings.captureResolutionPreset
        videoQualityPreset = persistedSettings.videoQualityPreset
        appUUID = UUID().uuidString.lowercased()
        websiteUserID = persistedSettings.websiteUserID ?? ""
        unlockedPaidFeatures = []
        shortcutKey = persistedSettings.shortcutKey.isEmpty ? "9" : persistedSettings.shortcutKey
        useCommand = persistedSettings.useCommand
        useShift = persistedSettings.useShift
        useOption = persistedSettings.useOption
        useControl = persistedSettings.useControl
        saveDirectoryPath = persistedSettings.saveDirectoryPath.isEmpty ? defaultSaveDirectory : persistedSettings.saveDirectoryPath
        selectedCaptureDisplayID = persistedSettings.selectedCaptureDisplayID.isEmpty ? Self.defaultCaptureDisplayID() : persistedSettings.selectedCaptureDisplayID
        discordWebhookURLString = Self.lockedDiscordWebhookURL
        base44Token = persistedSettings.base44Token ?? ""
        developerAccessToken = Self.loadDeveloperAccessToken()
        hasCompletedOnboarding = persistedSettings.hasCompletedOnboarding
        lastSeenLaunchSetupVersion = Self.normalizedLaunchSetupVersion(persistedSettings.lastSeenLaunchSetupVersion)
        hasAcknowledgedFourKProUnlock = persistedSettings.hasAcknowledgedFourKProUnlock ?? false
        customVoiceCommandPhrase = persistedSettings.customVoiceCommandPhrase
        shouldShowLaunchSetup = Self.shouldPresentLaunchSetup(lastSeenVersion: lastSeenLaunchSetupVersion)
        isCloudConnected = !base44Token.isEmpty || !websiteUserID.isEmpty
        uploadedClipURLs = Set(persistedSettings.uploadedClipURLs)
        captureDeviceProfiles = persistedSettings.captureDeviceProfiles

        if let storedProfile = captureDeviceProfiles[selectedCaptureDisplayID] {
            applyCaptureDeviceProfile(storedProfile)
        }

        captureResolutionPreset = resolvedCaptureResolutionPreset(for: captureResolutionPreset)
        if captureResolutionPreset == .p2160 {
            videoQualityPreset = .highest
        }

        recorder.onUnexpectedStop = { [weak self] error in
            self?.handleUnexpectedRecorderStop(error)
        }
        recorder.onMicrophoneSampleBuffer = { [weak self] sampleBuffer in
            self?.voiceCommandManager.appendExternalAudioSampleBuffer(sampleBuffer)
        }

        voiceCommandManager.onClipCommand = { [weak self] command in
            Task { @MainActor in
                self?.handleVoiceClipCommand(command)
            }
        }
        voiceCommandManager.setPreferredMicrophoneDeviceID(resolvedSelectedMicrophoneDeviceID)
        if let phrase = customVoiceCommandPhrase, !phrase.isEmpty {
            voiceCommandManager.setCustomTriggerCommand(phrase)
        }

        log("AppModel initialized")
        savePreferences()
        reloadClips()
        refreshDiagnosticsLog()
        observeApplicationLifecycle()
        handlePendingIncomingFeatureActivationURLs()
        handleDeepLinks()
        Task { await registerAppInstallation() }
        startEntitlementSyncLoop()
        requestNotificationAuthorizationIfNeeded()
        if isDeveloperBuild, !developerAccessToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Task { await restoreDeveloperSession() }
        }
    }

    // Polls the backend for the latest entitlements and updates unlockedPaidFeatures
    private func refreshEntitlementsFromBackend() async {
        guard !isEntitlementSyncInFlight else {
            return
        }

        isEntitlementSyncInFlight = true
        defer { isEntitlementSyncInFlight = false }

        log(" Entitlement sync: checking for appUUID=" + appUUID)
        guard let endpoint = Self.accountServiceAPIURL(path: "entitlements/by-user-id") else {
            log(" Entitlement sync: invalid API base URL")
            return
        }

        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            log(" Entitlement sync: invalid entitlement URL components")
            return
        }

        components.queryItems = [URLQueryItem(name: "appUuid", value: appUUID)]

        guard let url = components.url else {
            log(" Entitlement sync: failed to build entitlement URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 5

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let httpResponse = response as? HTTPURLResponse
            guard let httpResponse = httpResponse, httpResponse.statusCode == 200 else {
                log(" Entitlement sync: got status " + String(httpResponse?.statusCode ?? 0))
                return
            }
            markBackendConnectionAlive(showNotification: false)
            if let payload = try? JSONDecoder().decode(BackendEntitlementSnapshot.self, from: data) {
                applyBackendEntitlementSnapshot(payload)
            }
        } catch {
            markBackendConnectionUnavailable()
            log(" Entitlement sync error: " + error.localizedDescription)
        }
    }

    private func registerAppInstallation() async {
        guard let url = Self.accountServiceAPIURL(path: "app-installations/resolve"),
              let machineIdentity = MachineIdentityProvider.current() else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
#if DEBUG
        let payload = AppInstallationRegistrationPayload(
            appUuid: appUUID,
            machineIdentifier: machineIdentity.identifier,
            machineName: machineIdentity.name,
            machineModel: machineIdentity.modelIdentifier,
            systemVersion: machineIdentity.systemVersion,
            appVersion: Self.appShortVersionString(),
            buildVersion: Self.appBuildVersionString(),
            ownerLocked: true
        )
#else
        let payload = AppInstallationRegistrationPayload(
            appUuid: appUUID,
            machineIdentifier: machineIdentity.identifier,
            machineName: machineIdentity.name,
            machineModel: machineIdentity.modelIdentifier,
            systemVersion: machineIdentity.systemVersion,
            appVersion: Self.appShortVersionString(),
            buildVersion: Self.appBuildVersionString(),
            ownerLocked: false
        )
#endif
        request.httpBody = try? JSONEncoder().encode(payload)
        request.timeoutInterval = 5

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...201).contains(httpResponse.statusCode),
                  let snapshot = try? JSONDecoder().decode(AppInstallationRegistrationSnapshot.self, from: data) else {
                return
            }

            markBackendConnectionAlive(showNotification: true)

            let newAppUuid = snapshot.installation.appUuid
            hasResolvedInstallationIdentity = true
            if !newAppUuid.isEmpty, newAppUuid != appUUID {
                appUUID = newAppUuid
                savePreferences()
            }

            await refreshEntitlementsFromBackend()
        } catch {
            markBackendConnectionUnavailable()
        }
    }

    private func startEntitlementSyncLoop() {
        entitlementSyncTask?.cancel()
        entitlementSyncTask = Task { [weak self] in
            guard let self else { return }
            await refreshEntitlementsFromBackend()
            while !Task.isCancelled {
                if !hasResolvedInstallationIdentity {
                    await registerAppInstallation()
                }
                try? await Task.sleep(nanoseconds: 120_000_000_000)
                await refreshEntitlementsFromBackend()
            }
        }
    }

    // Structure for backend entitlement response
    private struct BackendEntitlementSnapshot: Decodable {
        let user: BackendEntitlementUser
    }
    private struct BackendEntitlementUser: Decodable {
        let id: String?
        let accountStatus: String?
        let subscriptionTier: String?
        let paidFeatures: [String]?
        let updatedAt: String?
    }

    // Applies backend entitlement snapshot to local state
    private func applyBackendEntitlementSnapshot(_ snapshot: BackendEntitlementSnapshot) {
        let normalizedTier = (snapshot.user.subscriptionTier ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let tierFeatures = normalizedTier == "pro" ? [PaidFeatureKey.fourKPro.rawValue] : []
        let normalizedFeatures = FeatureActivationManager.normalizedFeatures((snapshot.user.paidFeatures ?? []) + tierFeatures)
        let previousFeatures = Set(unlockedPaidFeatures)
        let currentFeatures = Set(normalizedFeatures)
        let addedFeatures = currentFeatures.subtracting(previousFeatures)
        let removedFeatures = previousFeatures.subtracting(currentFeatures)
        let isInitialEntitlementSnapshot = !hasAppliedInitialEntitlementSnapshot
        let shouldNotifyAboutEntitlementChanges = hasAppliedInitialEntitlementSnapshot
        let hasFourKProNow = currentFeatures.contains(PaidFeatureKey.fourKPro.rawValue)
        let shouldCelebrateRestoredFourK = isInitialEntitlementSnapshot
            && hasFourKProNow
            && !hasAcknowledgedFourKProUnlock
        var shouldPersistPreferences = false

        hasAppliedInitialEntitlementSnapshot = true

        if unlockedPaidFeatures != normalizedFeatures {
            log(" Entitlement CHANGED: " + Array(previousFeatures).description + " -> " + Array(currentFeatures).description)
            unlockedPaidFeatures = normalizedFeatures
            shouldPersistPreferences = true
            log(" Features now: " + String(describing: unlockedPaidFeatures))
            if shouldNotifyAboutEntitlementChanges, addedFeatures.contains(PaidFeatureKey.fourKPro.rawValue) {
                statusText = "4K Pro unlocked for this Mac."
                postFourKProAvailabilityNotification(restoredForThisInstallation: false)
            }
            if shouldNotifyAboutEntitlementChanges, removedFeatures.contains(PaidFeatureKey.fourKPro.rawValue) {
                _ = enforce4KProResolutionAccess(showStatus: false)
                statusText = "4K Pro was removed for this Mac."
                postFeatureEntitlementNotification(
                    title: "4K Pro removed",
                    message: "This Mac no longer has Pro access. Capture fell back to the free resolution tier.",
                    tone: .standard
                )
            }

        } else {
            log(" Features unchanged: " + String(describing: normalizedFeatures))
        }

        if shouldCelebrateRestoredFourK {
            postFourKProAvailabilityNotification(restoredForThisInstallation: true)
        }

        if hasFourKProNow, !hasAcknowledgedFourKProUnlock {
            hasAcknowledgedFourKProUnlock = true
            shouldPersistPreferences = true
        }

        if shouldPersistPreferences {
            savePreferences()
        }
    }

    private func markBackendConnectionAlive(showNotification: Bool) {
        let wasConnected = isBackendConnected
        isBackendConnected = true

        guard showNotification, !hasShownBackendConnectionNotification, !wasConnected else {
            return
        }

        hasShownBackendConnectionNotification = true
        statusText = "MacClipper is synced and ready."

        guard enableGameNotifications else { return }
        GameNotificationManager.shared.show(
            title: "Your Mac is in sync",
            message: "Everything clicked into place. MacClipper is ready for your next beautiful clip.",
            sourceApp: nil,
            tone: .celebratory
        )
    }

    private func markBackendConnectionUnavailable() {
        isBackendConnected = false
    }

    private func postFeatureEntitlementNotification(title: String, message: String, tone: GameNotificationTone) {
        // Purchase/entitlement changes are important account signals, so always show them.
        GameNotificationManager.shared.show(
            title: title,
            message: message,
            sourceApp: nil,
            tone: tone
        )
    }

    private func postFourKProAvailabilityNotification(restoredForThisInstallation: Bool) {
        postFeatureEntitlementNotification(
            title: restoredForThisInstallation ? "4K Pro is back" : "4K Pro unlocked",
            message: restoredForThisInstallation
                ? "Full-resolution capture lit back up on this Mac. Your next big moment can land in radiant 4K."
                : "Full-resolution capture just lit up. Your next big moment can land in radiant 4K.",
            tone: .celebratory
        )
    }

    private func handleDeepLinks() {
        NotificationCenter.default.addObserver(
            forName: AppDelegate.deepLinkNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let urls = notification.userInfo?[AppDelegate.deepLinkUserInfoKey] as? [URL] else { return }
            Task { @MainActor in
                for url in urls {
                    self?.handleDeepLink(url)
                }
            }
        }
    }

    private func handleDeepLink(_ url: URL) {
        if url.scheme == "macclipper" && url.host == "connect" {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let linkedWebsiteUserID = FeatureActivationManager.normalizedUserID(
                components?.queryItems?.first(where: { $0.name == "websiteUserId" })?.value ?? ""
            )
            let attemptID = (components?.queryItems?.first(where: { $0.name == "attemptId" })?.value ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            showConnectionSuccess(websiteUserID: linkedWebsiteUserID, attemptID: attemptID)
            return
        }

        handleIncomingFeatureActivationURL(url)
    }

    private func showConnectionSuccess(websiteUserID linkedWebsiteUserID: String = "", attemptID: String = "") {
        if !linkedWebsiteUserID.isEmpty {
            websiteUserID = linkedWebsiteUserID
        }

        let hasLinkedWebsiteUser = !websiteUserID.isEmpty

        // Redirect browser back to the website with this app's UUID so the link page
        // can complete the handshake (OAuth-callback style).
        if hasLinkedWebsiteUser {
            // Build the fragment WITH query params embedded so HashRouter can read them.
            // URLComponents.queryItems puts params before the '#', making them invisible
            // to React Router (useLocation returns empty search in that case).
            // Correct URL: https://macclipper.co/#/link-app?appUuid=X&linked=1&websiteUserId=Y
            var hashParams = URLComponents()
            hashParams.queryItems = [
                URLQueryItem(name: "appUuid", value: appUUID),
                URLQueryItem(name: "linked", value: "1"),
                URLQueryItem(name: "websiteUserId", value: websiteUserID),
                URLQueryItem(name: "attemptId", value: attemptID)
            ]
            var callbackComponents = URLComponents(string: "https://macclipper.co/")
            callbackComponents?.fragment = "/link-app?\(hashParams.query ?? "")"

            if let callbackURL = callbackComponents?.url {
                NSWorkspace.shared.open(callbackURL)
            }
            // Also register the link on the backend as a polling fallback.
            Task { await registerAppLink(websiteUserID: websiteUserID, attemptID: attemptID) }
        }

        if enableGameNotifications {
            GameNotificationManager.shared.show(
                title: "Successfully Connected!",
                message: hasLinkedWebsiteUser
                    ? "MacClipper is now linked to your dashboard account. New cloud links can show up on the website."
                    : "MacClipper received the cloud link handoff.",
                sourceApp: nil,
                tone: .celebratory
            )
        }
        statusText = hasLinkedWebsiteUser
            ? "MacClipper linked to your dashboard account."
            : "MacClipper received the link handoff."
        isCloudConnected = !base44Token.isEmpty || hasLinkedWebsiteUser
        log("cloud link established websiteUserID=\(websiteUserID.isEmpty ? "none" : websiteUserID)")
        savePreferences()
    }

    private func registerAppLink(websiteUserID linkedWebsiteUserID: String, attemptID: String = "") async {
        guard !linkedWebsiteUserID.isEmpty else { return }

        var candidateURLs: [URL] = []
        if let primaryURL = Self.accountServiceAPIURL(path: "app-link") {
            candidateURLs.append(primaryURL)
        }
        if let websiteURL = URL(string: "https://macclipper.co/api/app-link") {
            candidateURLs.append(websiteURL)
        }
        if let cloudFunctionURL = URL(string: "https://us-central1-macclipper-ce502.cloudfunctions.net/api/app-link") {
            candidateURLs.append(cloudFunctionURL)
        }

        let body: [String: String] = ["appUuid": appUUID, "websiteUserId": linkedWebsiteUserID, "attemptId": attemptID]
        let encodedBody = try? JSONEncoder().encode(body)

        for url in candidateURLs {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = encodedBody
            request.timeoutInterval = 5

            do {
                let (_, response) = try await URLSession.shared.data(for: request)
                if let httpResponse = response as? HTTPURLResponse,
                   (200...299).contains(httpResponse.statusCode) {
                    log("app-link registered websiteUserID=\(linkedWebsiteUserID) endpoint=\(url.absoluteString)")
                    return
                }

                if let httpResponse = response as? HTTPURLResponse {
                    log("app-link registration failed status=\(httpResponse.statusCode) endpoint=\(url.absoluteString)")
                }
            } catch {
                log("app-link registration error endpoint=\(url.absoluteString) error=\(error.localizedDescription)")
            }
        }

        log("app-link registration exhausted all endpoints websiteUserID=\(linkedWebsiteUserID)")
    }

    func openCloudConnectURL() {
        var components = URLComponents(string: "https://macclipper.co/")
        components?.fragment = "link-app?appUuid=\(appUUID.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? appUUID)"
        let url = components?.url ?? URL(string: "https://macclipper.co/#/link-app")!
        NSWorkspace.shared.open(url)
    }

    func openCloudDashboard() {
        let url = URL(string: "https://macclipper.co/#/dashboard")!
        NSWorkspace.shared.open(url)
    }

    var shortcutDisplayText: String {
        currentShortcut.displayString
    }

    var lastClipName: String? {
        lastClipURL?.lastPathComponent
    }

    var clipCountText: String {
        clips.isEmpty ? "No clips saved yet" : "\(clips.count) saved clip\(clips.count == 1 ? "" : "s")"
    }

    var hasDiscordWebhookConfigured: Bool {
        !discordWebhookURLString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var availableCaptureDisplays: [CaptureDisplayOption] {
        Self.captureDisplayOptions()
    }

    var availableMicrophones: [MicrophoneOption] {
        Self.microphoneOptions(selectedMicrophoneID: selectedMicrophoneID)
    }

    var selectedCaptureDisplaySummary: String {
        let displays = availableCaptureDisplays
        return displays.first(where: { $0.id == selectedCaptureDisplayID })?.title
            ?? displays.first?.title
            ?? "Current Display"
    }

    var selectedMicrophoneSummary: String {
        availableMicrophones.first(where: { $0.id == selectedMicrophoneID })?.title
            ?? (selectedMicrophoneID.isEmpty ? "System Default" : "Unavailable Microphone")
    }

    var microphoneStatusText: String {
        includeMicrophone ? "Microphone On" : "Microphone Off"
    }

    var systemAudioLevelPercent: Int {
        Int((systemAudioLevel * 100).rounded())
    }

    var microphoneAudioLevelPercent: Int {
        Int((microphoneAudioLevel * 100).rounded())
    }

    var systemAudioSettingsSubtitle: String {
        captureSystemAudio
            ? "Desktop and app sound will be captured at \(systemAudioLevelPercent)% volume."
            : "Desktop sound is muted from clips."
    }

    var systemAudioLevelSubtitle: String {
        captureSystemAudio
            ? "Lower this if your tutor, game, or desktop audio is overpowering your voice."
            : "Turn System Audio on to adjust its recorded volume."
    }

    var microphoneAudioLevelSubtitle: String {
        includeMicrophone
            ? "Raise this if your voice is quieter than the people or apps you are recording."
            : "Turn Microphone on to adjust how loud your voice sounds in saved clips."
    }

    var microphoneSelectionSubtitle: String {
        if selectedMicrophoneID.isEmpty {
            if let defaultMicrophone = Self.defaultMicrophoneDevice() {
                return "Using macOS default input: \(defaultMicrophone.localizedName)"
            }
            return "Using the macOS system default microphone"
        }

        if let selectedDevice = Self.microphoneDevice(withID: selectedMicrophoneID) {
            return "Using \(selectedDevice.localizedName) for clip audio and voice commands"
        }

        if let defaultMicrophone = Self.defaultMicrophoneDevice() {
            return "Saved microphone is unavailable. Falling back to \(defaultMicrophone.localizedName)"
        }

        return "Saved microphone is unavailable. MacClipper will fall back to the system default input."
    }

    var microphoneSettingsSubtitle: String {
        let inputDescription = selectedMicrophoneID.isEmpty ? "the system default input" : selectedMicrophoneSummary
        let voiceTriggerNote = shouldUseRecorderMicrophoneFeedForVoiceCommands
            ? " Voice trigger is sharing the same live capture mic instead of opening a second mic session."
            : ""

        if includeMicrophone && captureSystemAudio && microphoneCaptureSuppressed && shouldPreventEchoBySuppressingMicrophone {
            return "Microphone capture is temporarily disabled to prevent echo because this input is a loopback/system-monitor source while System Audio is on."
        }

        if includeMicrophone {
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .denied, .restricted:
                return "\(inputDescription) is selected, but macOS microphone access is blocked right now"
            case .notDetermined:
                return microphoneCaptureSuppressed
                    ? "Allow microphone access so \(inputDescription) can record your voice"
                    : "Ready on \(inputDescription).\(voiceTriggerNote)"
            case .authorized:
                return "Ready on \(inputDescription).\(voiceTriggerNote)"
            @unknown default:
                return "Ready on \(inputDescription).\(voiceTriggerNote)"
            }
        }

        return "Voice capture disabled"
    }

    var hasUnlocked4KPro: Bool {
        unlockedPaidFeatures.contains(PaidFeatureKey.fourKPro.rawValue)
    }

    var captureResolutionSelectionSummary: String {
        resolvedCaptureResolutionPreset(for: captureResolutionPreset).displayName
    }

    var appUUIDDisplayText: String {
        appUUID
    }

    var appUUIDShortDisplayText: String {
        String(appUUID.prefix(8)).uppercased()
    }

    var appUUIDSubtitle: String {
        "MacClipper creates this install UUID on first launch. Use it for bot grants, linking this Mac, and support when you need to identify this app install."
    }

    var isDeveloperBuild: Bool {
        Self.isDeveloperBuildEnabled()
    }

    var developerInstallationCountText: String {
        let count = filteredDeveloperInstallations.count
        if count == 0 {
            return developerInstallations.isEmpty ? "No tracked Macs loaded yet" : "No Macs match the current search"
        }

        return "\(count) tracked Mac\(count == 1 ? "" : "s")"
    }

    var filteredDeveloperInstallations: [DeveloperInstallationSummary] {
        let query = developerSearchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else {
            return developerInstallations
        }

        return developerInstallations.filter { installation in
            let searchFields = [
                installation.installation.appUuid,
                installation.installation.machineName,
                installation.installation.machineModel,
                installation.installation.appVersion,
                installation.installation.buildVersion,
                installation.linkedUser?.displayName ?? "",
                installation.linkedUser?.email ?? "",
                installation.linkedUser?.discordUsername ?? ""
            ]

            return searchFields.contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }


    var captureResolutionSettingsSubtitle: String {
        if hasUnlocked4KPro {
            if captureResolutionPreset == .p2160 {
                return "Full 3840x2160 capture is enabled and locked to Highest quality."
            }

            return "MacClipper Pro is unlocked. Switch to 4K whenever you want full-resolution clips."
        }

        return "720p through 1440p stay free. Buy MacClipper Pro once on the website and MacClipper will unlock it after this Mac securely syncs with your account."
    }

    var fourKProStatusText: String {
        if hasUnlocked4KPro {
            return "Purchased and active on this Mac."
        }
        return "Locked. Buy MacClipper Pro once and MacClipper will unlock 4K after a secure entitlement sync."
    }

    var diagnosticsLogFilePath: String {
        AppLogger.shared.logFileURL.path
    }

    private var currentShortcut: Shortcut {
        Shortcut(
            key: shortcutKey,
            command: useCommand,
            shift: useShift,
            option: useOption,
            control: useControl
        )
    }

    private var resolvedSelectedMicrophoneDeviceID: String? {
        Self.resolvedMicrophoneDeviceID(from: selectedMicrophoneID)
    }

    private var shouldUseRecorderMicrophoneFeedForVoiceCommands: Bool {
        isRecording && includeMicrophone && !microphoneCaptureSuppressed
    }

    private var shouldPreventEchoBySuppressingMicrophone: Bool {
        guard includeMicrophone, captureSystemAudio else { return false }

        let selectedDevice = Self.microphoneDevice(withID: selectedMicrophoneID)
        let selectedName = (selectedDevice?.localizedName ?? "").lowercased()
        return Self.isLikelyLoopbackMicrophoneName(selectedName)
    }

    private var lowPowerModeEnabled: Bool {
        if #available(macOS 12.0, *) {
            return ProcessInfo.processInfo.isLowPowerModeEnabled
        }

        return false
    }

    private func runtimeAdjustedRecorderSettings(_ settings: RecorderSettings) -> RecorderSettings {
        var adjustedSettings = settings
        let thermalState = ProcessInfo.processInfo.thermalState

        if thermalState == .serious || thermalState == .critical {
            adjustedSettings.videoQuality = .performance
            if adjustedSettings.resolutionPreset == .p2160 || adjustedSettings.resolutionPreset == .p1440 {
                adjustedSettings.resolutionPreset = .p1080
            }
            adjustedSettings.clipDuration = min(adjustedSettings.clipDuration, 45)
            return adjustedSettings
        }

        if lowPowerModeEnabled {
            if adjustedSettings.videoQuality == .highest {
                adjustedSettings.videoQuality = .balanced
            }
            if adjustedSettings.resolutionPreset == .p2160 {
                adjustedSettings.resolutionPreset = .p1440
            }
            adjustedSettings.clipDuration = min(adjustedSettings.clipDuration, 60)
        }

        return adjustedSettings
    }

    private var currentSettings: RecorderSettings {
        let resolvedResolutionPreset = resolvedCaptureResolutionPreset(for: captureResolutionPreset)
        let settings = RecorderSettings(
            clipDuration: clipDuration,
            saveDirectory: URL(fileURLWithPath: saveDirectoryPath, isDirectory: true),
            includeMicrophone: includeMicrophone && !microphoneCaptureSuppressed,
            preferredMicrophoneDeviceID: resolvedSelectedMicrophoneDeviceID,
            captureSystemAudio: captureSystemAudio,
            systemAudioLevel: systemAudioLevel,
            microphoneAudioLevel: microphoneAudioLevel,
            showCursor: showCursor,
            preferredDisplayID: UInt32(selectedCaptureDisplayID),
            resolutionPreset: resolvedResolutionPreset,
            videoQuality: effectiveVideoQualityPreset(for: videoQualityPreset, resolutionPreset: resolvedResolutionPreset)
        )

        return runtimeAdjustedRecorderSettings(settings)
    }

    func captureResolutionOptionTitle(for preset: CaptureResolutionPreset) -> String {
        guard preset.requires4KProUnlock, !hasUnlocked4KPro else {
            return preset.displayName
        }

        return "\(preset.displayName) Buy"
    }

    func savePreferences() {
        clipDuration = Self.normalizedClipDuration(clipDuration)
        startReplayBufferOnLaunch = true
        shortcutKey = String((shortcutKey.isEmpty ? "9" : shortcutKey.prefix(1))).uppercased()
        appUUID = Self.resolvedAppUUID(appUUID)
        unlockedPaidFeatures = FeatureActivationManager.normalizedFeatures(unlockedPaidFeatures)
        captureResolutionPreset = resolvedCaptureResolutionPreset(for: captureResolutionPreset)
        videoQualityPreset = effectiveVideoQualityPreset(for: videoQualityPreset, resolutionPreset: captureResolutionPreset)
        systemAudioLevel = Self.normalizedSystemAudioLevel(systemAudioLevel)
        microphoneAudioLevel = Self.normalizedMicrophoneAudioLevel(microphoneAudioLevel)

        defaults.set(clipDuration, forKey: "clipDuration")
        defaults.set(startReplayBufferOnLaunch, forKey: "startReplayBufferOnLaunch")
        defaults.set(includeMicrophone, forKey: "includeMicrophone")
        defaults.set(selectedMicrophoneID, forKey: "selectedMicrophoneID")
        defaults.set(captureSystemAudio, forKey: "captureSystemAudio")
        defaults.set(systemAudioLevel, forKey: "systemAudioLevel")
        defaults.set(microphoneAudioLevel, forKey: "microphoneAudioLevel")
        defaults.set(showCursor, forKey: "showCursor")
        defaults.set(enableGameNotifications, forKey: "enableGameNotifications")
        defaults.set(captureResolutionPreset.rawValue, forKey: "captureResolutionPreset")
        defaults.set(videoQualityPreset.rawValue, forKey: "videoQualityPreset")
        defaults.set(appUUID, forKey: "appUUID")
        defaults.removeObject(forKey: "unlockedPaidFeatures")
        defaults.set(shortcutKey, forKey: "shortcutKey")
        defaults.set(useCommand, forKey: "useCommand")
        defaults.set(useShift, forKey: "useShift")
        defaults.set(useOption, forKey: "useOption")
        defaults.set(useControl, forKey: "useControl")
        defaults.set(saveDirectoryPath, forKey: "saveDirectoryPath")
        defaults.set(selectedCaptureDisplayID, forKey: "selectedCaptureDisplayID")
        discordWebhookURLString = Self.lockedDiscordWebhookURL
        defaults.set(Self.lockedDiscordWebhookURL, forKey: "discordWebhookURLString")
        persistCaptureDeviceProfile(for: selectedCaptureDisplayID)
        persistSettingsSnapshot()

        hotkeyManager.register(shortcut: currentShortcut) { [weak self] in
            Task { @MainActor in
                self?.saveClip()
            }
        }
        voiceCommandManager.setPreferredMicrophoneDeviceID(resolvedSelectedMicrophoneDeviceID)
        refreshMicrophoneCaptureSuppression()
        refreshVoiceCommandListenerState()
        recorder.update(settings: currentSettings)
    }

    func completeOnboarding() {
        hasCompletedOnboarding = true
        acknowledgeLaunchSetupForCurrentVersion()
        savePreferences()
    }

    func dismissLaunchSetup() {
        acknowledgeLaunchSetupForCurrentVersion()
        savePreferences()
    }

    func resetOnboarding() {
        hasCompletedOnboarding = false
        lastSeenLaunchSetupVersion = nil
        shouldShowLaunchSetup = true
        savePreferences()
    }

    func setVideoQualityPreset(_ preset: VideoQualityPreset) {
        if captureResolutionPreset == .p2160 && preset != .highest {
            if videoQualityPreset != .highest {
                videoQualityPreset = .highest
                savePreferences()
            }
            statusText = "4K Pro stays on Highest quality for full-detail capture."
            return
        }

        guard videoQualityPreset != preset else { return }
        videoQualityPreset = preset
        savePreferences()
    }

    func setCaptureResolutionPreset(_ preset: CaptureResolutionPreset) {
        if preset.requires4KProUnlock && !hasUnlocked4KPro {
            statusText = "Pro opens on the website subscription page. Buy it once and MacClipper will unlock it on the way back."
            open4KPurchasePage()
            return
        }

        let resolvedPreset = resolvedCaptureResolutionPreset(for: preset)
        let resolvedQuality = effectiveVideoQualityPreset(for: videoQualityPreset, resolutionPreset: resolvedPreset)
        let didChangeResolution = captureResolutionPreset != resolvedPreset
        let didChangeQuality = videoQualityPreset != resolvedQuality

        guard didChangeResolution || didChangeQuality else { return }

        captureResolutionPreset = resolvedPreset
        videoQualityPreset = resolvedQuality
        if resolvedPreset == .p2160 {
            statusText = "4K Pro is enabled at Highest quality."
        }
        savePreferences()
    }

    func setSelectedCaptureDisplayID(_ displayID: String) {
        guard selectedCaptureDisplayID != displayID else { return }
        persistCaptureDeviceProfile(for: selectedCaptureDisplayID)
        selectedCaptureDisplayID = displayID
        if let storedProfile = captureDeviceProfiles[displayID] {
            applyCaptureDeviceProfile(storedProfile)
        }
        savePreferences()

        guard isRecording, !isBusy else { return }
        restartRecording(status: "Switching capture to \(selectedCaptureDisplaySummary)…")
    }

    func setSelectedMicrophoneID(_ microphoneID: String) {
        guard selectedMicrophoneID != microphoneID else { return }

        selectedMicrophoneID = microphoneID
        let microphoneLogID = microphoneID.isEmpty ? "system-default" : microphoneID
        log("microphone input changed id=\(microphoneLogID)")
        savePreferences()

        guard includeMicrophone, isRecording, !isBusy else { return }
        restartRecording(status: "Switching microphone input…")
    }

    func open4KPurchasePage() {
        guard let purchaseURL = Self.purchasePortalURL() else {
            statusText = "MacClipper could not build the website purchase URL."
            return
        }

        guard var components = URLComponents(url: purchaseURL, resolvingAgainstBaseURL: false) else {
            NSWorkspace.shared.open(purchaseURL)
            return
        }

        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "appUuid" }
        queryItems.append(URLQueryItem(name: "appUuid", value: appUUID))
        components.queryItems = queryItems

        NSWorkspace.shared.open(components.url ?? purchaseURL)
    }

    func copyAppUUID() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(appUUID, forType: .string)
        statusText = "Copied app UUID."
    }

    func developerAuthenticate() {
        guard !isDeveloperBusy else { return }
        Task { await authenticateDeveloperSession(showNotification: true) }
    }

    func developerSignOut() {
        DeveloperAccessStore.clearToken(service: Self.developerAccessStoreService())
        developerAccessToken = ""
        developerInstallations = []
        developerStatusText = "Signed out of the Firebase admin session."
    }

    func refreshDeveloperInstallations() {
        guard !isDeveloperBusy else { return }
        Task { await reloadDeveloperInstallations() }
    }

    private func restoreDeveloperSession() async {
        await authenticateDeveloperSession(showNotification: false)
    }

    private func authenticateDeveloperSession(showNotification: Bool) async {
        guard isDeveloperBuild else { return }
        let accessToken = developerAccessToken.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !accessToken.isEmpty else {
            developerStatusText = "Enter the Firebase developer access token to continue."
            return
        }

        guard let apiBaseURL = Self.accountServiceAPIBaseURL() else {
            developerStatusText = "MacClipper could not build the Firebase admin API URL."
            return
        }

        isDeveloperBusy = true
        defer { isDeveloperBusy = false }

        do {
            try await DeveloperAdminClient.validateSession(apiBaseURL: apiBaseURL, accessToken: accessToken)
            try DeveloperAccessStore.saveToken(accessToken, service: Self.developerAccessStoreService())
            developerStatusText = "Firebase admin connected. Loading tracked Macs…"

            if showNotification {
                postFeatureEntitlementNotification(
                    title: "Firebase admin ready",
                    message: "MacClipper Dev signed into the private Firebase admin API.",
                    tone: .celebratory
                )
            }

            let installations = try await DeveloperAdminClient.listInstallations(apiBaseURL: apiBaseURL, accessToken: accessToken, limit: 120)
            developerInstallations = installations
            developerStatusText = installations.isEmpty
                ? "Firebase admin connected. No tracked Macs are registered yet."
                : "Firebase admin connected. Loaded \(installations.count) tracked Macs."
        } catch {
            developerStatusText = error.localizedDescription
        }
    }

    private func reloadDeveloperInstallations() async {
        guard isDeveloperBuild else { return }
        let accessToken = developerAccessToken.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !accessToken.isEmpty else {
            developerInstallations = []
            developerStatusText = "Sign in to Firebase admin before loading tracked Macs."
            return
        }

        guard let apiBaseURL = Self.accountServiceAPIBaseURL() else {
            developerStatusText = "MacClipper could not build the Firebase admin API URL."
            return
        }

        isDeveloperBusy = true
        defer { isDeveloperBusy = false }

        do {
            let installations = try await DeveloperAdminClient.listInstallations(apiBaseURL: apiBaseURL, accessToken: accessToken, limit: 120)
            developerInstallations = installations
            developerStatusText = installations.isEmpty
                ? "Firebase admin connected. No tracked Macs are registered yet."
                : "Firebase admin connected. Loaded \(installations.count) tracked Macs."
        } catch {
            developerStatusText = error.localizedDescription
        }
    }

    // func copyWebsiteUserID removed

    func reloadClips() {
        let folderURL = URL(fileURLWithPath: saveDirectoryPath, isDirectory: true)
        try? ClipStorageManager.ensureRootDirectory(at: folderURL)
        let loadedClips = ClipLibraryLoader.loadSavedClips(from: folderURL, uploadedClipURLs: [])
        applyLoadedClips(loadedClips, preferredLastClipURL: lastClipURL, preferredSelectedClipURL: selectedClip?.url)
    }

    private func observeApplicationLifecycle() {
        let center = NotificationCenter.default

        notificationObservers = [
            center.addObserver(forName: NSApplication.didFinishLaunchingNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.refreshVoiceCommandListenerState()
                    self?.scheduleAutomaticRecordingStartIfNeeded(after: 0.75)
                }
            },
            center.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.refreshVoiceCommandListenerState()
                    self?.ensureRecordingActive(reason: "Keeping capture live…")
                    self?.retryAutomaticRecordingStartIfNeeded()
                }
            },
            center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.savePreferences()
                }
            },
            center.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.voiceCommandManager.stop()
                    self?.entitlementSyncTask?.cancel()
                    self?.savePreferences()
                }
            },
            center.addObserver(forName: AppDelegate.deepLinkNotification, object: nil, queue: .main) { [weak self] notification in
                guard let urls = notification.userInfo?[AppDelegate.deepLinkUserInfoKey] as? [URL] else { return }
                Task { @MainActor in
                    self?.handleIncomingFeatureActivationURLs(urls)
                }
            }
        ]

        refreshVoiceCommandListenerState()
        scheduleAutomaticRecordingStartIfNeeded(after: 0.75)
    }

    private func scheduleAutomaticRecordingStartIfNeeded(after delay: TimeInterval) {
        guard startReplayBufferOnLaunch, !didAttemptInitialRecording else { return }
        didAttemptInitialRecording = true

        Task { @MainActor [weak self] in
            guard let self else { return }
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }

            guard self.startReplayBufferOnLaunch, !self.isRecording, !self.isBusy else { return }
            self.startRecording()
        }
    }

    private func retryAutomaticRecordingStartIfNeeded() {
        guard shouldRetryAutomaticStart, startReplayBufferOnLaunch, !isRecording, !isBusy else { return }
        shouldRetryAutomaticStart = false
        startRecording()
    }

    func ensureRecordingActive(reason: String = "Keeping capture live…") {
        guard startReplayBufferOnLaunch, !isRecording, !isBusy else { return }
        restartRecording(status: reason)
    }

    @discardableResult
    private func handleRecordingStartError(_ error: Error) -> Bool {
        switch error {
        case RecorderError.screenPermissionDenied:
            shouldRetryAutomaticStart = true
            statusText = "MacClipper needs Screen Recording permission to capture your screen."
            PrivacyPermissionNavigator.requestAndOpenSettings(for: .screenRecording)
            return false
        case RecorderError.microphonePermissionDenied:
            if includeMicrophone && !microphoneCaptureSuppressed {
                microphoneCaptureSuppressed = true
                refreshVoiceCommandListenerState()
                shouldRetryAutomaticStart = false
                statusText = "Microphone access was denied, so capture is retrying without microphone audio. Your saved microphone setting stays on."
                return true
            }

            shouldRetryAutomaticStart = false
            statusText = "Allow Microphone access in System Settings, then return to MacClipper."
            PrivacyPermissionNavigator.requestAndOpenSettings(for: .microphone)
            return false
        default:
            shouldRetryAutomaticStart = startReplayBufferOnLaunch
            statusText = error.localizedDescription
            // Always try to preserve buffer when recovering, even on errors
            scheduleAutomaticRearm(after: 2.5, preservingBuffer: true, status: "Retrying capture…")
            return false
        }
    }

    func toggleRecording() {
        guard !isBusy else { return }

        if !isRecording {
            startRecording()
            return
        }

        statusText = "Capture stays on while MacClipper is open."
    }

    func setStartReplayBufferOnLaunch(_ enabled: Bool) {
        startReplayBufferOnLaunch = true
        savePreferences()

        guard !isBusy else { return }

        if !isRecording {
            startRecording()
        }
    }

    func startRecording() {
        guard !isBusy, !isRecording else { return }
        refreshMicrophoneCaptureSuppression()
        log("startRecording requested")
        armRecording(status: "Starting capture…", preservingBuffer: false)
    }

    private func restartRecording(status: String) {
        guard !isBusy else { return }
        refreshMicrophoneCaptureSuppression()
        log("restartRecording requested status=\(status)")
        armRecording(status: status, preservingBuffer: false)
    }

    private func recoverRecording(status: String) {
        guard !isBusy, !isRecording else { return }
        refreshMicrophoneCaptureSuppression()
        log("recoverRecording requested status=\(status)")
        armRecording(status: status, preservingBuffer: true)
    }

    private func armRecording(status: String, preservingBuffer: Bool) {
        automaticRearmTask?.cancel()
        isBusy = true
        statusText = status

        Task {
            let shouldRetryImmediately: Bool

            do {
                try await recorder.start(with: currentSettings, preservingBuffer: preservingBuffer)
                shouldRetryAutomaticStart = false
                isRecoveringRecorder = false
                statusText = preservingBuffer
                    ? "Capture recovered on \(selectedCaptureDisplaySummary)"
                    : "Capture is live on \(selectedCaptureDisplaySummary)"
                log("recorder armed preservingBuffer=\(preservingBuffer) display=\(selectedCaptureDisplaySummary)")
                isRecording = true
                refreshVoiceCommandListenerState()
                shouldRetryImmediately = false
            } catch {
                shouldRetryImmediately = handleRecordingStartError(error)
                if !shouldRetryImmediately {
                    isRecoveringRecorder = false
                }
                log("recorder start failed message=\(error.localizedDescription)")
                isRecording = false
                refreshVoiceCommandListenerState()
            }
            isBusy = false

            if shouldRetryImmediately {
                startRecording()
            } else if isRecording, !pendingClipRequests.isEmpty {
                processNextQueuedClipIfNeeded()
            }
        }
    }

    func stopRecording() {
        log("stopRecording ignored because capture is always on")
        statusText = "Capture stays on while MacClipper is open."
    }

    func saveClip() {
        guard isRecording else {
            log("saveClip ignored because recorder is not active")
            return
        }
        guard !isBusy || isProcessingClipQueue else {
            log("saveClip ignored because recorder is busy without an active clip queue")
            return
        }

        let request = PendingClipRequest(
            capturePoint: recorder.makeCapturePoint(),
            duration: Int(clipDuration),
            sourceApp: captureSourceAppSnapshot(),
            suppressMicrophoneInExport: false
        )

        let sourceName = request.sourceApp?.name ?? CaptureSourceAppDetector.desktopSourceApp.name
        log("clip queued duration=\(request.duration) source=\(sourceName)")

        pendingClipRequests.append(request)
        let queuedClipCount = pendingClipRequests.count + (isProcessingClipQueue ? 1 : 0)

        if queuedClipCount > 1 {
            statusText = "Clipping \(queuedClipCount) clips…"
            postQueuedClipNotification(totalCount: queuedClipCount, sourceApp: request.sourceApp)
        } else {
            statusText = clipProgressText(for: request)
            postClipStartedNotification(sourceApp: request.sourceApp, duration: request.duration)
        }

        processNextQueuedClipIfNeeded()
    }

    private func handleVoiceClipCommand(_ command: String) {
        log("voice clip command received command=\(command)")

        guard isRecording else {
            ensureRecordingActive(reason: "Voice command heard. Re-arming capture…")
            statusText = "Heard \"Mac clip that\", but capture is not live yet."
            return
        }

        saveClip()
    }

    private func processNextQueuedClipIfNeeded() {
        guard isRecording, !isProcessingClipQueue, !pendingClipRequests.isEmpty else { return }

        isProcessingClipQueue = true
        isBusy = true
        let request = pendingClipRequests.removeFirst()
        activeClipRequest = request
        log("processing clip request duration=\(request.duration) source=\(request.sourceApp?.name ?? CaptureSourceAppDetector.desktopSourceApp.name)")

        if !pendingClipRequests.isEmpty {
            statusText = "Clipping \(pendingClipRequests.count + 1) clips…"
        } else {
            statusText = clipProgressText(for: request)
        }

        Task {
            do {
                let clipURL = try await recorder.saveReplayClip(
                    capturePoint: request.capturePoint,
                    suppressMicrophoneInExport: request.suppressMicrophoneInExport
                )
                persistMetadata(for: clipURL, sourceApp: request.sourceApp, capturedAt: request.capturePoint.requestedAt)
                lastClipURL = clipURL
                insertSavedClipIntoLibrary(clipURL, sourceApp: request.sourceApp, capturedAt: request.capturePoint.requestedAt)
                postClipSavedNotification(for: clipURL, sourceApp: request.sourceApp, duration: request.duration)
                log("clip saved output=\(clipURL.lastPathComponent)")
                let remainingCount = pendingClipRequests.count
                statusText = remainingCount > 0
                    ? "Saved \(clipURL.lastPathComponent) • \(remainingCount) more queued"
                    : "Saved \(clipURL.lastPathComponent)"
            } catch let recorderError as RecorderError {
                if !isRecoveringRecorder {
                    statusText = recorderError.localizedDescription
                    log("clip failed recorderError=\(recorderError.localizedDescription)")
                    switch recorderError {
                    case .bufferNotReady, .noBufferedClip:
                        break
                    case .captureStalled:
                        handleUnexpectedRecorderStop(recorderError)
                    default:
                        postClipFailedNotification(
                            sourceApp: request.sourceApp,
                            title: request.sourceApp.map { "\($0.name) clip failed" } ?? "Clip failed",
                            message: recorderError.localizedDescription
                        )
                    }
                }
            } catch {
                if !isRecoveringRecorder {
                    statusText = error.localizedDescription
                    log("clip failed error=\(error.localizedDescription)")
                    postClipFailedNotification(
                        sourceApp: request.sourceApp,
                        title: request.sourceApp.map { "\($0.name) clip failed" } ?? "Clip failed",
                        message: error.localizedDescription
                    )
                }
            }

            if activeClipRequest?.id == request.id {
                activeClipRequest = nil
            }

            isProcessingClipQueue = false
            if pendingClipRequests.isEmpty {
                isBusy = false
            } else {
                processNextQueuedClipIfNeeded()
            }
        }
    }

    func openClipsFolder() {
        guard !saveDirectoryPath.isEmpty else {
            let url = URL(fileURLWithPath: defaultSaveDirectory, isDirectory: true)
            try? ClipStorageManager.ensureRootDirectory(at: url)
            NSWorkspace.shared.open(url)
            return
        }
        let url = URL(fileURLWithPath: saveDirectoryPath, isDirectory: true)
        try? ClipStorageManager.ensureRootDirectory(at: url)
        NSWorkspace.shared.open(url)
    }

    func openClip(_ clip: SavedClip) {
        NSWorkspace.shared.open(clip.url)
    }

    func revealClip(at clipURL: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([clipURL])
    }

    func deleteClip(_ clip: SavedClip) {
        let fileManager = FileManager.default
        let metadataURL = ClipLibraryLoader.metadataURL(for: clip.url)

        do {
            if fileManager.fileExists(atPath: metadataURL.path) {
                try? fileManager.removeItem(at: metadataURL)
            }

            var trashedURL: NSURL?
            if fileManager.fileExists(atPath: clip.url.path) {
                try fileManager.trashItem(at: clip.url, resultingItemURL: &trashedURL)
            }

            clips.removeAll { $0.url == clip.url }
            if lastClipURL == clip.url {
                lastClipURL = clips.first?.url
            }

            if selectedClip?.url == clip.url {
                selectedClip = clips.first
            }

            statusText = "Deleted \(clip.url.lastPathComponent)"
            log("clip deleted file=\(clip.url.lastPathComponent)")
        } catch {
            statusText = "Could not delete \(clip.url.lastPathComponent)"
            log("clip delete failed file=\(clip.url.lastPathComponent) message=\(error.localizedDescription)")
        }
    }

    func testDiscordWebhook() {
        let webhookURL = discordWebhookURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !webhookURL.isEmpty else {
            postClipFailedNotification(
                sourceApp: nil,
                title: "Public posting unavailable",
                message: "This build is missing its locked online post target."
            )
            return
        }

        statusText = "Testing public posting…"

        Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                try await self.discordWebhookManager.testWebhook(webhookURLString: webhookURL)
                self.statusText = "Public posting is ready"
                self.postDiscordConnectionSuccessNotification()
            } catch {
                self.statusText = error.localizedDescription
                self.postClipFailedNotification(
                    sourceApp: nil,
                    title: "Public post test failed",
                    message: error.localizedDescription
                )
            }
        }
    }

    func showPublicPostingUnavailableNotice() {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Public posting isn't ready"
        alert.informativeText = "This build is supposed to ship with a locked online post target. Reinstall the latest MacClipper build if posting stays unavailable."
        alert.addButton(withTitle: "Close")

        NSApplication.shared.activate(ignoringOtherApps: true)
        _ = alert.runModal()
    }

    func pickSaveDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose Clips Folder"

        if panel.runModal() == .OK, let url = panel.url {
            saveDirectoryPath = url.path
            log("save directory changed path=\(url.path)")
            savePreferences()
            reloadClips()
        }
    }

    func refreshDiagnosticsLog() {
        diagnosticsLogText = AppLogger.shared.readLog()
        diagnosticsLogStatusText = "Loaded log at \(Self.logTimestampString(from: Date()))"
    }

    func copyDiagnosticsLog() {
        let logText = AppLogger.shared.readLog()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(logText, forType: .string)
        diagnosticsLogText = logText
        diagnosticsLogStatusText = "Copied diagnostics log at \(Self.logTimestampString(from: Date()))"
    }

    func clearDiagnosticsLog() {
        AppLogger.shared.clearLog()
        diagnosticsLogText = AppLogger.shared.readLog()
        diagnosticsLogStatusText = "Cleared diagnostics log at \(Self.logTimestampString(from: Date()))"
    }

    func revealDiagnosticsLog() {
        let logURL = AppLogger.shared.logFileURL
        if FileManager.default.fileExists(atPath: logURL.path) {
            NSWorkspace.shared.activateFileViewerSelecting([logURL])
        } else {
            NSWorkspace.shared.open(logURL.deletingLastPathComponent())
        }
    }

    func clearAppCache() {
        let bufferDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("MacClipperBuffer", isDirectory: true)
        if let contents = try? FileManager.default.contentsOfDirectory(at: bufferDirectory, includingPropertiesForKeys: nil) {
            for fileURL in contents {
                try? FileManager.default.removeItem(at: fileURL)
            }
        }
        uploadedClipURLs = []
        savePreferences()
        log("Cache cleared: buffer files removed, upload tracking reset")
        statusText = "Cache cleared."
    }

    private func captureSourceAppSnapshot() -> ClipSourceApp? {
        CaptureSourceAppDetector.captureCurrentSourceApp(bundleIdentifier: Bundle.main.bundleIdentifier)
    }

    private static func defaultCaptureDisplayID() -> String {
        if let mainScreen = NSScreen.main,
           let screenNumber = mainScreen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            return String(screenNumber.uint32Value)
        }

        if let firstScreen = NSScreen.screens.first,
           let screenNumber = firstScreen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            return String(screenNumber.uint32Value)
        }

        return "0"
    }

    private static func captureDisplayOptions() -> [CaptureDisplayOption] {
        NSScreen.screens.compactMap { screen in
            guard let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                return nil
            }

            let displayID = screenNumber.uint32Value
            let titleSuffix = screen == NSScreen.main ? " (Main)" : ""
            let width = Int(screen.frame.width.rounded())
            let height = Int(screen.frame.height.rounded())

            return CaptureDisplayOption(
                id: String(displayID),
                title: "\(screen.localizedName)\(titleSuffix)",
                detail: "\(width)x\(height)"
            )
        }
    }

    private static func audioCaptureDevices() -> [AVCaptureDevice] {
        AudioCaptureDeviceCatalog.devices()
    }

    private static func defaultMicrophoneDevice() -> AVCaptureDevice? {
        AudioCaptureDeviceCatalog.preferredDevice(preferredUniqueID: nil)
    }

    private static func microphoneDevice(withID deviceID: String) -> AVCaptureDevice? {
        guard !deviceID.isEmpty else { return defaultMicrophoneDevice() }
        return AudioCaptureDeviceCatalog.device(withUniqueID: deviceID)
    }

    private static func resolvedMicrophoneDeviceID(from deviceID: String) -> String? {
        guard !deviceID.isEmpty else { return nil }
        return microphoneDevice(withID: deviceID)?.uniqueID
    }

    private static func microphoneOptions(selectedMicrophoneID: String) -> [MicrophoneOption] {
        let devices = audioCaptureDevices()
        let defaultDetail = defaultMicrophoneDevice()?.localizedName ?? "Follow macOS input"
        var options = [
            MicrophoneOption(id: "", title: "System Default", detail: defaultDetail)
        ]

        options.append(contentsOf: devices.map { device in
            MicrophoneOption(id: device.uniqueID, title: device.localizedName, detail: "")
        })

        if !selectedMicrophoneID.isEmpty && !options.contains(where: { $0.id == selectedMicrophoneID }) {
            options.append(
                MicrophoneOption(
                    id: selectedMicrophoneID,
                    title: "Unavailable Microphone",
                    detail: "Reconnect it or choose another input"
                )
            )
        }

        return options
    }

    private static func isLikelyLoopbackMicrophoneName(_ value: String) -> Bool {
        guard !value.isEmpty else { return false }

        let loopbackKeywords = [
            "blackhole",
            "loopback",
            "virtual",
            "monitor",
            "stereo mix",
            "system mix",
            "aggregate",
            "vb-audio",
            "soundflower"
        ]

        return loopbackKeywords.contains(where: { value.localizedCaseInsensitiveContains($0) })
    }

    private func resolvedCaptureResolutionPreset(for preset: CaptureResolutionPreset) -> CaptureResolutionPreset {
        guard preset.requires4KProUnlock, !hasUnlocked4KPro else {
            return preset
        }

        return .highestFreePreset
    }

    private func effectiveVideoQualityPreset(for preset: VideoQualityPreset, resolutionPreset: CaptureResolutionPreset) -> VideoQualityPreset {
        resolutionPreset == .p2160 ? .highest : preset
    }

    @discardableResult
    private func enforce4KProResolutionAccess(showStatus: Bool) -> Bool {
        let resolvedPreset = resolvedCaptureResolutionPreset(for: captureResolutionPreset)
        guard resolvedPreset != captureResolutionPreset else { return false }

        captureResolutionPreset = resolvedPreset
        if showStatus {
            statusText = "4K Pro is not active on this Mac yet, so capture dropped back to \(resolvedPreset.displayName)."
        }
        return true
    }

    private func handlePendingIncomingFeatureActivationURLs() {
        handleIncomingFeatureActivationURLs(AppDelegate.takePendingIncomingURLs())
    }

    private func handleIncomingFeatureActivationURLs(_ urls: [URL]) {
        urls.forEach(handleIncomingFeatureActivationURL)
    }

    private func handleIncomingFeatureActivationURL(_ url: URL) {
        guard url.scheme?.lowercased() == "macclipper" else { return }

        let normalizedHost = (url.host ?? "").lowercased()
        let normalizedPath = url.path.lowercased()
        let isFeatureGrantURL = normalizedHost == "feature-grant"
            || normalizedHost == "purchase-complete"
            || normalizedPath == "/feature-grant"
            || normalizedPath == "/purchase-complete"

        guard isFeatureGrantURL,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return
        }

        let queryItems = components.queryItems ?? []
        let normalizedUserID = FeatureActivationManager.normalizedUserID(
            queryItems.first(where: { $0.name == "userId" })?.value ?? ""
        )
        let normalizedFeature = FeatureActivationManager.normalizedFeature(
            queryItems.first(where: { $0.name == "feature" })?.value ?? ""
        )

        if !normalizedUserID.isEmpty {
            websiteUserID = normalizedUserID
        }

        refreshEntitlementsAfterPurchaseRedirect(feature: normalizedFeature)
    }

    private func refreshEntitlementsAfterPurchaseRedirect(feature: String) {
        let featureName = feature.isEmpty
            ? "your account"
            : FeatureActivationManager.featureDisplayName(feature)

        statusText = "Refreshing \(featureName) access for this Mac..."
        savePreferences()

        Task { [weak self] in
            guard let self else { return }

            if !self.hasResolvedInstallationIdentity {
                await self.registerAppInstallation()
                return
            }

            await self.refreshEntitlementsFromBackend()
        }
    }

    private static func purchasePortalURL() -> URL? {
        let configuredURL = ((Bundle.main.object(forInfoDictionaryKey: "MacClipperAccountPortalURL") as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedURLString = configuredURL.isEmpty ? defaultPurchasePortalURLString : configuredURL
        return URL(string: resolvedURLString)
    }

    private static func configuredAccountServiceAPIBaseURL() -> URL? {
        let configuredURL = ((Bundle.main.object(forInfoDictionaryKey: "MacClipperAPIBaseURL") as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !configuredURL.isEmpty else {
            return nil
        }

        return URL(string: configuredURL)
    }

    private static func accountServiceBaseURL() -> URL? {
        guard let purchasePortalURL = purchasePortalURL(),
              let scheme = purchasePortalURL.scheme,
              let host = purchasePortalURL.host else {
            return nil
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = purchasePortalURL.port
        return components.url
    }

    private static func accountServiceAPIBaseURL() -> URL? {
        if let configuredAPIBaseURL = configuredAccountServiceAPIBaseURL() {
            return configuredAPIBaseURL
        }

        guard let baseURL = accountServiceBaseURL() else {
            return nil
        }

        return baseURL.appendingPathComponent("api", isDirectory: false)
    }

    private static func accountServiceAPIURL(path: String) -> URL? {
        guard let baseURL = accountServiceAPIBaseURL() else {
            return nil
        }

        if path.isEmpty {
            return baseURL
        }

        return baseURL.appendingPathComponent(path, isDirectory: false)
    }

    private static func isDeveloperBuildEnabled() -> Bool {
        (Bundle.main.object(forInfoDictionaryKey: "MacClipperDeveloperMode") as? Bool) ?? false
    }

    private static func developerAccessStoreService() -> String {
        ((Bundle.main.bundleIdentifier ?? "local.macclipper.app") + ".firebase-admin")
            .lowercased()
    }

    private static func loadDeveloperAccessToken() -> String {
        guard isDeveloperBuildEnabled() else {
            return ""
        }

        return DeveloperAccessStore.loadToken(service: developerAccessStoreService()) ?? ""
    }

    private static func appShortVersionString() -> String {
        ((Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func appBuildVersionString() -> String {
        ((Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? "0")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func currentLaunchSetupVersion() -> String {
        "\(appShortVersionString())+\(appBuildVersionString())"
    }

    private static func normalizedLaunchSetupVersion(_ value: String?) -> String? {
        let normalizedValue = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return normalizedValue.isEmpty ? nil : normalizedValue
    }

    private static func shouldPresentLaunchSetup(lastSeenVersion: String?) -> Bool {
        normalizedLaunchSetupVersion(lastSeenVersion) != currentLaunchSetupVersion()
    }

    private func acknowledgeLaunchSetupForCurrentVersion() {
        lastSeenLaunchSetupVersion = Self.currentLaunchSetupVersion()
        shouldShowLaunchSetup = false
    }

    private func handleUnexpectedRecorderStop(_ error: Error) {
        if let activeClipRequest {
            pendingClipRequests.insert(activeClipRequest, at: 0)
            self.activeClipRequest = nil
        }

        isRecording = false
        isBusy = false
        isProcessingClipQueue = false
        isRecoveringRecorder = true
        shouldRetryAutomaticStart = true
        refreshVoiceCommandListenerState()
        statusText = "Capture interrupted. Reconnecting desktop capture…"
        log("unexpected recorder stop message=\(error.localizedDescription)")

        guard startReplayBufferOnLaunch else { return }

        // Always try to preserve buffer when recovering from unexpected stops
        scheduleAutomaticRearm(after: 0.75, preservingBuffer: true, status: "Reconnecting capture…")

        NSLog("MacClipper capture interrupted: \(error.localizedDescription)")
    }

    private func scheduleAutomaticRearm(after delay: TimeInterval, preservingBuffer: Bool, status: String) {
        automaticRearmTask?.cancel()

        guard startReplayBufferOnLaunch else { return }

        automaticRearmTask = Task { @MainActor [weak self] in
            guard let self else { return }
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }

            guard !Task.isCancelled else { return }
            guard self.startReplayBufferOnLaunch, !self.isRecording, !self.isBusy else { return }

            // Always preserve buffer when recovering from interruptions
            if preservingBuffer || self.isRecoveringRecorder {
                self.recoverRecording(status: status)
            } else {
                self.restartRecording(status: status)
            }
        }
    }

    private func persistMetadata(for clipURL: URL, sourceApp: ClipSourceApp?, capturedAt: Date = Date()) {
        let metadata = ClipMetadata(sourceApp: sourceApp, capturedAt: capturedAt)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        do {
            let data = try encoder.encode(metadata)
            try data.write(to: ClipLibraryLoader.metadataURL(for: clipURL), options: .atomicWrite)
        } catch {
            NSLog("MacClipper metadata write failed: \(error.localizedDescription)")
        }
    }

    private func requestNotificationAuthorizationIfNeeded() {
        guard !enableGameNotifications else { return }

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, error in
            if let error {
                NSLog("MacClipper notification authorization error: \(error.localizedDescription)")
            }
        }
    }

    private func postClipStartedNotification(sourceApp: ClipSourceApp?, duration: Int) {
        ClipSoundEffectPlayer.shared.play(.clipStarted)

        guard enableGameNotifications else { return }

        let gameName = sourceApp?.name ?? CaptureSourceAppDetector.desktopSourceApp.name
        let message = sourceApp?.isDesktopCapture == true
            ? "Trimming the last \(duration) seconds from desktop capture…"
            : "Saving the last \(duration) seconds…"
        GameNotificationManager.shared.show(
            title: "\(gameName) clipping now",
            message: message,
            sourceApp: sourceApp
        )
    }

    private func clipProgressText(for request: PendingClipRequest) -> String {
        if let sourceApp = request.sourceApp {
            if sourceApp.isDesktopCapture {
                return "Desktop trimming \(request.duration) seconds…"
            }
            return "Clipping \(sourceApp.name) • last \(request.duration) seconds…"
        }

        return "Desktop trimming \(request.duration) seconds…"
    }

    private func postQueuedClipNotification(totalCount: Int, sourceApp: ClipSourceApp?) {
        guard enableGameNotifications, totalCount > 1 else { return }

        GameNotificationManager.shared.show(
            title: "Clipping \(totalCount) clips",
            message: "MacClipper queued your shortcuts and is saving them one by one.",
            sourceApp: sourceApp
        )
    }

    private func postClipSavedNotification(for clipURL: URL, sourceApp: ClipSourceApp?, duration: Int) {
        ClipSoundEffectPlayer.shared.play(.clipSaved)

        let title: String
        if let sourceApp {
            title = sourceApp.isDesktopCapture ? "Desktop clip saved" : "\(sourceApp.name) clip saved"
        } else {
            title = "Clip saved"
        }
        let message = "Finished and saved in \(clipURL.deletingLastPathComponent().path)"

        if enableGameNotifications {
            GameNotificationManager.shared.show(
                title: title,
                message: message,
                sourceApp: sourceApp,
                previewURL: clipURL,
                actions: clipSavedActions(for: clipURL, sourceApp: sourceApp)
            )
            return
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.subtitle = "Last \(duration) seconds captured and in your folder"
        content.body = clipURL.lastPathComponent
        decorateSystemNotificationContent(content)

        let request = UNNotificationRequest(
            identifier: "clip-saved-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                NSLog("MacClipper notification delivery error: \(error.localizedDescription)")
            }
        }
    }

    private func clipSavedActions(for clipURL: URL, sourceApp: ClipSourceApp?) -> [GameNotificationAction] {
        var actions: [GameNotificationAction] = [
            GameNotificationAction(title: "Share", systemImage: "square.and.arrow.up", tint: MacClipperTheme.cyan) { [weak self] in
                self?.presentSharePanel(for: clipURL, sourceApp: sourceApp)
            },
            GameNotificationAction(title: "Copy", systemImage: "doc.on.doc", tint: MacClipperTheme.success) { [weak self] in
                self?.copyClipToClipboard(clipURL)
            },
            GameNotificationAction(title: "Reveal", systemImage: "folder.fill", tint: MacClipperTheme.ember) { [weak self] in
                self?.revealClip(at: clipURL)
            }
        ]

        if hasDiscordWebhookConfigured {
            actions.append(
                GameNotificationAction(title: "Post Online", systemImage: "paperplane.fill", tint: MacClipperTheme.cyan) { [weak self] in
                    self?.uploadClipToDiscord(clipURL, sourceApp: sourceApp)
                }
            )
        }

        return actions
    }

    func copyClipToClipboard(_ clipURL: URL) {
        NSPasteboard.general.clearContents()

        if NSPasteboard.general.writeObjects([clipURL as NSURL]) {
            statusText = "Copied clip to clipboard"
        } else {
            NSPasteboard.general.setString(clipURL.path, forType: .string)
            statusText = "Copied clip path"
        }
    }

    func presentClipSharePanel(for clip: SavedClip) {
        selectedClip = clip
        presentSharePanel(for: clip.url, sourceApp: clip.sourceApp)
    }

    func uploadClipToCloud(_ clip: SavedClip) {
        selectedClip = clip
        uploadClipToCloudDirectly(clip.url, sourceApp: clip.sourceApp)
    }

    private func presentSharePanel(for clipURL: URL, sourceApp: ClipSourceApp?) {
        ClipSharePanelManager.shared.show(
            clipURL: clipURL,
            discordConnected: hasDiscordWebhookConfigured,
            onCloud: { [weak self] in
                self?.uploadClipToCloudDirectly(clipURL, sourceApp: sourceApp)
            },
            onDiscordChannel: { [weak self] in
                guard let self else { return }
                if self.hasDiscordWebhookConfigured {
                    self.uploadClipToDiscord(clipURL, sourceApp: sourceApp, mode: .channelUpload)
                } else {
                    self.showPublicPostingUnavailableNotice()
                }
            },
            onDiscordDM: { [weak self] in
                guard let self else { return }
                if self.hasDiscordWebhookConfigured {
                    self.uploadClipToDiscord(clipURL, sourceApp: sourceApp, mode: .directMessageHandoff)
                } else {
                    self.showPublicPostingUnavailableNotice()
                }
            },
            onOther: {
            }
        )
    }

    private func uploadClipToCloudDirectly(_ clipURL: URL, sourceApp: ClipSourceApp?) {
        let clipPath = clipURL.path
        let clipName = clipURL.deletingPathExtension().lastPathComponent
        let linkedWebsiteUserID = FeatureActivationManager.normalizedUserID(websiteUserID)

        guard !linkedWebsiteUserID.isEmpty else {
            statusText = "Link MacClipper to the website before using Cloud"
            cloudShareStatus = CloudShareStatusSummary(
                clipPath: clipPath,
                clipName: clipName,
                startedAt: Date(),
                state: .needsWebsiteLink
            )
            log("cloud upload redirected for linking file=\(clipURL.lastPathComponent)")
            openCloudConnectURL()
            return
        }

        guard activeCloudUploadPaths.insert(clipURL.path).inserted else {
            statusText = "Cloud upload already in progress"
            log("cloud upload ignored duplicate file=\(clipURL.lastPathComponent)")
            return
        }

        statusText = "Creating cloud link…"
        log("cloud upload requested file=\(clipURL.lastPathComponent) linkedWebsiteUserID=\(linkedWebsiteUserID.isEmpty ? "none" : linkedWebsiteUserID)")
        cloudShareStatus = CloudShareStatusSummary(
            clipPath: clipPath,
            clipName: clipName,
            startedAt: Date(),
            state: .processing
        )

        let clipCloudShareClient = self.clipCloudShareClient
        let appUUID = self.appUUID
        let orientation = Self.inferredClipOrientation(for: clipURL)

        Task.detached(priority: .userInitiated) { [clipURL, clipPath, clipName, sourceApp, clipCloudShareClient, appUUID, orientation, linkedWebsiteUserID] in
            do {
                let sharedURL = try await clipCloudShareClient.uploadClip(
                    fileURL: clipURL,
                    clipName: clipName,
                    orientation: orientation,
                    appUUID: appUUID,
                    websiteUserID: linkedWebsiteUserID.isEmpty ? nil : linkedWebsiteUserID
                )

                await MainActor.run { [weak self] in
                    guard let self else { return }
                    self.activeCloudUploadPaths.remove(clipPath)
                    self.uploadedClipURLs.insert(clipPath)
                    self.savePreferences()
                    self.reloadClips()
                    self.statusText = "Uploaded \(clipURL.lastPathComponent) to MacClipper Cloud"
                    self.log("cloud upload succeeded file=\(clipURL.lastPathComponent) uploadedURL=\(sharedURL.absoluteString)")
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        await self.completeCloudShareStatusAfterMinimumDelay(
                            for: clipPath,
                            clipName: clipName,
                            state: .uploaded(sharedURL: sharedURL)
                        )
                        self.presentCloudShareSuccessPrompt(for: sharedURL, clipName: clipName)
                    }
                }
            } catch {
                let errorMessage = error.localizedDescription
                await MainActor.run { [weak self] in
                    guard let self else { return }
                    self.activeCloudUploadPaths.remove(clipPath)
                    self.statusText = errorMessage
                    self.log("cloud upload failed file=\(clipURL.lastPathComponent) message=\(errorMessage)")
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        await self.completeCloudShareStatusAfterMinimumDelay(
                            for: clipPath,
                            clipName: clipName,
                            state: .failed(message: errorMessage)
                        )
                    }
                    ClipCloudUploadPanelManager.shared.showFailure(clipName: clipName, message: errorMessage)
                    self.postClipFailedNotification(
                        sourceApp: sourceApp,
                        title: "Cloud upload failed",
                        message: errorMessage
                    )
                }
            }
        }
    }

    @MainActor
    private func completeCloudShareStatusAfterMinimumDelay(
        for clipPath: String,
        clipName: String,
        state: CloudShareStatusSummary.State
    ) async {
        let minimumDuration: TimeInterval = 3
        let startedAt = cloudShareStatus?.clipPath == clipPath
            ? (cloudShareStatus?.startedAt ?? Date())
            : Date()
        let elapsed = Date().timeIntervalSince(startedAt)

        if elapsed < minimumDuration {
            try? await Task.sleep(nanoseconds: UInt64((minimumDuration - elapsed) * 1_000_000_000))
        }

        guard cloudShareStatus?.clipPath == clipPath else {
            return
        }

        cloudShareStatus = CloudShareStatusSummary(
            clipPath: clipPath,
            clipName: clipName,
            startedAt: startedAt,
            state: state
        )
    }

    func clearCloudShareStatus(for clip: SavedClip) {
        guard cloudShareStatus?.clipPath == clip.url.path else {
            return
        }

        cloudShareStatus = nil
    }

    private func uploadClipToDiscord(_ clipURL: URL, sourceApp: ClipSourceApp?, mode: DiscordShareMode = .channelUpload) {
        let webhookURL = discordWebhookURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !webhookURL.isEmpty else {
            postClipFailedNotification(
                sourceApp: sourceApp,
                title: "Public posting unavailable",
                message: "This build is missing its locked online post target."
            )
            return
        }

        guard activeDiscordUploadPaths.insert(clipURL.path).inserted else {
            statusText = "Discord upload already in progress"
            return
        }

        statusText = "Posting clip online…"
        let modeLabel = mode == .directMessageHandoff ? "dm" : "channel"
        log("discord upload requested file=\(clipURL.lastPathComponent) mode=\(modeLabel)")

        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.activeDiscordUploadPaths.remove(clipURL.path) }

            do {
                let uploadedURL = try await self.discordWebhookManager.uploadClip(
                    fileURL: clipURL,
                    webhookURLString: webhookURL,
                    message: self.discordUploadMessage(for: clipURL, sourceApp: sourceApp)
                )
                if mode == .directMessageHandoff {
                    if let uploadedURL {
                        self.copyToPasteboard(uploadedURL.absoluteString, statusMessage: "Copied post link")
                    }
                    self.openDiscord()
                    self.statusText = uploadedURL == nil
                        ? "Opened Discord after posting"
                        : "Copied post link and opened Discord"
                } else {
                    self.statusText = "Posted \(clipURL.lastPathComponent) online"
                }

                self.postDiscordUploadSuccessNotification(
                    for: clipURL,
                    uploadedURL: uploadedURL,
                    sourceApp: sourceApp,
                    mode: mode
                )
                self.log("discord upload succeeded file=\(clipURL.lastPathComponent) mode=\(modeLabel) uploadedURL=\(uploadedURL?.absoluteString ?? "none")")
            } catch {
                self.statusText = error.localizedDescription
                self.log("discord upload failed file=\(clipURL.lastPathComponent) mode=\(modeLabel) message=\(error.localizedDescription)")
                self.postClipFailedNotification(
                    sourceApp: sourceApp,
                    title: "Public post failed",
                    message: error.localizedDescription
                )
            }
        }
    }

    private func presentCloudShareSuccessPrompt(for sharedURL: URL, clipName: String) {
        statusText = "Clouded \(clipName)"
    }

    private func discordUploadMessage(for clipURL: URL, sourceApp: ClipSourceApp?) -> String {
        let appName = sourceApp?.name ?? "Unknown App"
        return "MacClipper clip from \(appName)"
    }

    func uploadClipToBase44(_ clipURL: URL, sourceApp: ClipSourceApp?) {
        // uploadClipToSupabase(clipURL, sourceApp: sourceApp)
    }

    nonisolated private static func inferredClipOrientation(for clipURL: URL) -> MiniCutExportOrientation {
        let asset = AVURLAsset(url: clipURL)
        guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            return .horizontal
        }

        let orientedRect = CGRect(origin: .zero, size: videoTrack.naturalSize)
            .applying(videoTrack.preferredTransform)
        let orientedSize = CGSize(width: abs(orientedRect.width), height: abs(orientedRect.height))

        return orientedSize.height > orientedSize.width ? .vertical : .horizontal
    }

    // func uploadClipToSupabase(_ clipURL: URL, sourceApp: ClipSourceApp?) {
    //     guard activeDiscordUploadPaths.insert(clipURL.path).inserted else {
    //         statusText = "Upload already in progress"
    //         return
    //     }
    //
    //     statusText = "Uploading clip to Supabase…"
    //     log("supabase upload requested file=\(clipURL.lastPathComponent)")
    //
    //     Task { @MainActor [weak self] in
    //         guard let self else { return }
    //         defer { self.activeDiscordUploadPaths.remove(clipURL.path) }
    //
    //         do {
    //             let fileData = try Data(contentsOf: clipURL)
    //             let filename = clipURL.lastPathComponent
    //             let userId = "user-id" // Get from auth, for now placeholder
    //
    //             let filePath = "\(userId)/\(filename)"
    //
    //             // Upload to Supabase Storage
    //             let storage = self.supabase.storage.from("clips")
    //             _ = try await storage.upload(
    //                 path: filePath,
    //                 file: fileData,
    //                 options: FileOptions(
    //                     contentType: "video/mp4",
    //                     upsert: false
    //                 )
    //             )
    //
    //             // Get public URL
    //             let publicURL = try await storage.getPublicURL(path: filePath)
    //
    //             // Save to database
    //             struct ClipRecord: Encodable {
    //                 let content: String
    //                 let user_id: String
    //             }
    //             let clip = ClipRecord(content: publicURL.absoluteString, user_id: userId)
    //
    //             _ = try await self.supabase
    //                 .from("clips")
    //                 .insert(clip)
    //
    //             self.uploadedClipURLs.insert(clipURL.path)
    //             self.statusText = "Uploaded \(clipURL.lastPathComponent) to Supabase"
    //             self.log("supabase upload succeeded file=\(clipURL.lastPathComponent)")
    //             self.copyToPasteboard(publicURL.absoluteString, statusMessage: "Copied Supabase link")
    //
    //         } catch {
    //             self.statusText = error.localizedDescription
    //             self.log("supabase upload failed file=\(clipURL.lastPathComponent) message=\(error.localizedDescription)")
    //             self.postClipFailedNotification(
    //                 sourceApp: sourceApp,
    //                 title: "Supabase upload failed",
    //                 message: error.localizedDescription
    //             )
    //         }
    //     }
    // }

    private func postDiscordConnectionSuccessNotification() {
        if enableGameNotifications {
            GameNotificationManager.shared.show(
                title: "Public posting is ready",
                message: "MacClipper can now send clips to the locked online feed in this build.",
                sourceApp: nil
            )
            return
        }

        let content = UNMutableNotificationContent()
        content.title = "Public posting is ready"
        content.body = "MacClipper can now send clips to the locked online feed in this build."
        content.sound = .default
        decorateSystemNotificationContent(content)

        let request = UNNotificationRequest(
            identifier: "discord-connected-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                NSLog("MacClipper Discord connection notification error: \(error.localizedDescription)")
            }
        }
    }

    private func postDiscordUploadSuccessNotification(
        for clipURL: URL,
        uploadedURL: URL?,
        sourceApp: ClipSourceApp?,
        mode: DiscordShareMode
    ) {
        let title: String
        let message: String

        switch mode {
        case .channelUpload:
            title = "Posted Online"
            message = uploadedURL == nil
                ? "Sent to your locked public feed."
                : "Posted online. The hosted clip link is ready too."
        case .directMessageHandoff:
            title = "Posted + Opened Discord"
            message = uploadedURL == nil
                ? "Posted online and opened Discord so you can forward it anywhere."
                : "Posted online, copied the hosted link, and opened Discord so you can drop it anywhere."
        }

        if enableGameNotifications {
            var actions: [GameNotificationAction] = [
                GameNotificationAction(title: "Reveal", systemImage: "folder.fill", tint: MacClipperTheme.ember) { [weak self] in
                    self?.revealClip(at: clipURL)
                }
            ]

            if let uploadedURL {
                actions.append(
                    GameNotificationAction(title: "Copy Link", systemImage: "link", tint: MacClipperTheme.cyan) { [weak self] in
                        self?.copyToPasteboard(uploadedURL.absoluteString)
                    }
                )
            }

            if mode == .directMessageHandoff {
                actions.append(
                    GameNotificationAction(title: "Open Discord", systemImage: "bubble.left.and.bubble.right.fill", tint: MacClipperTheme.cyan) { [weak self] in
                        self?.openDiscord()
                    }
                )
            }

            GameNotificationManager.shared.show(
                title: title,
                message: message,
                sourceApp: sourceApp,
                previewURL: clipURL,
                actions: actions
            )
            return
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = message
        content.sound = .default
        decorateSystemNotificationContent(content)

        let request = UNNotificationRequest(
            identifier: "discord-upload-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                NSLog("MacClipper Discord success notification error: \(error.localizedDescription)")
            }
        }
    }

    private func copyToPasteboard(_ value: String, statusMessage: String = "Copied clip link") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        statusText = statusMessage
    }

    private func log(_ message: String) {
        AppLogger.shared.log("App", message)
    }

    private func openDiscord() {
        if let applicationURL = Self.discordApplicationURL() {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            NSWorkspace.shared.openApplication(at: applicationURL, configuration: configuration) { _, error in
                if let error {
                    NSLog("MacClipper Discord open error: \(error.localizedDescription)")
                }
            }
            return
        }

        if let webURL = URL(string: "https://discord.com/channels/@me") {
            NSWorkspace.shared.open(webURL)
        }
    }

    private static func discordApplicationURL() -> URL? {
        let bundleIdentifiers = [
            "com.hnc.Discord",
            "com.hnc.DiscordPTB",
            "com.hnc.DiscordCanary",
            "com.hnc.DiscordDevelopment"
        ]

        for bundleIdentifier in bundleIdentifiers {
            if let applicationURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) {
                return applicationURL
            }
        }

        return nil
    }

    private func postClipFailedNotification(sourceApp: ClipSourceApp?, title: String, message: String) {
        if enableGameNotifications {
            Task { @MainActor in
                GameNotificationManager.shared.show(title: title, message: message, sourceApp: sourceApp)
            }
            return
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = message
        content.sound = .default
        decorateSystemNotificationContent(content)

        let request = UNNotificationRequest(
            identifier: "clip-failed-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                NSLog("MacClipper failure notification error: \(error.localizedDescription)")
            }
        }
    }

    private func postBufferWarmupNotificationIfNeeded(sourceApp: ClipSourceApp?) {
        let now = Date()
        if let lastWarmupNotificationAt,
           now.timeIntervalSince(lastWarmupNotificationAt) < 4 {
            return
        }
        lastWarmupNotificationAt = now

        let title = sourceApp.map { "\($0.name) capture warming up" } ?? "Capture warming up"
        let message = "Try clipping again in a second."

        if enableGameNotifications {
            Task { @MainActor in
                GameNotificationManager.shared.show(
                    title: title,
                    message: message,
                    sourceApp: sourceApp
                )
            }
            return
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = message
        content.sound = .default
        decorateSystemNotificationContent(content)

        let request = UNNotificationRequest(
            identifier: "buffer-warmup-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                NSLog("MacClipper warmup notification error: \(error.localizedDescription)")
            }
        }
    }

    private func applyLoadedClips(
        _ loadedClips: [SavedClip],
        preferredLastClipURL: URL?,
        preferredSelectedClipURL: URL?
    ) {
        clips = loadedClips

        if let preferredLastClipURL,
           let matched = loadedClips.first(where: { $0.url == preferredLastClipURL }) {
            selectedClip = matched
        } else if let preferredSelectedClipURL,
                  let matched = loadedClips.first(where: { $0.url == preferredSelectedClipURL }) {
            selectedClip = matched
        } else {
            selectedClip = loadedClips.first
        }
    }

    private func decorateSystemNotificationContent(_ content: UNMutableNotificationContent) {
        if let appIconAttachment = MacClipperIconAsset.notificationAttachment() {
            content.attachments = [appIconAttachment]
        }
    }

    private func insertSavedClipIntoLibrary(_ clipURL: URL, sourceApp: ClipSourceApp?, capturedAt: Date) {
        guard let savedClip = ClipLibraryLoader.makeSavedClip(
            from: clipURL,
            fallbackCreatedAt: capturedAt,
            sourceApp: sourceApp
        ) else {
            reloadClips()
            return
        }

        clips.removeAll { $0.url == clipURL }
        let insertionIndex = clips.firstIndex(where: { $0.createdAt < savedClip.createdAt }) ?? clips.endIndex
        clips.insert(savedClip, at: insertionIndex)
        selectedClip = savedClip
    }

    private func applyCaptureDeviceProfile(_ profile: CaptureDeviceSettingsProfile) {
        clipDuration = Self.normalizedClipDuration(profile.clipDuration)
        includeMicrophone = profile.includeMicrophone
        captureSystemAudio = profile.captureSystemAudio
        systemAudioLevel = Self.resolvedSystemAudioLevel(
            persistedLevel: profile.systemAudioLevel,
            persistedMicrophoneLevel: profile.microphoneAudioLevel
        )
        microphoneAudioLevel = Self.normalizedMicrophoneAudioLevel(profile.microphoneAudioLevel ?? 1.0)
        showCursor = profile.showCursor
        captureResolutionPreset = resolvedCaptureResolutionPreset(for: profile.captureResolutionPreset)
        videoQualityPreset = effectiveVideoQualityPreset(for: profile.videoQualityPreset, resolutionPreset: captureResolutionPreset)
    }

    private func persistCaptureDeviceProfile(for displayID: String) {
        guard !displayID.isEmpty else { return }

        captureDeviceProfiles[displayID] = CaptureDeviceSettingsProfile(
            clipDuration: Self.normalizedClipDuration(clipDuration),
            includeMicrophone: includeMicrophone,
            captureSystemAudio: captureSystemAudio,
            systemAudioLevel: systemAudioLevel,
            microphoneAudioLevel: microphoneAudioLevel,
            showCursor: showCursor,
            captureResolutionPreset: captureResolutionPreset,
            videoQualityPreset: videoQualityPreset
        )

        guard let data = try? JSONEncoder().encode(captureDeviceProfiles) else { return }
        defaults.set(data, forKey: Self.captureDeviceProfilesKey)
    }

    private static func loadClipDuration(from defaults: UserDefaults) -> Double {
        if let number = defaults.object(forKey: "clipDuration") as? NSNumber {
            return normalizedClipDuration(number.doubleValue)
        }

        if let stringValue = defaults.string(forKey: "clipDuration"),
           let parsedValue = Double(stringValue) {
            return normalizedClipDuration(parsedValue)
        }

        return 30
    }

    private static func normalizedClipDuration(_ duration: Double) -> Double {
        min(120, max(15, (duration / 5).rounded() * 5))
    }

    private static func normalizedSystemAudioLevel(_ level: Double) -> Double {
        min(1.0, max(0.0, (level * 20).rounded() / 20))
    }

    private static func normalizedMicrophoneAudioLevel(_ level: Double) -> Double {
        min(2.0, max(0.0, (level * 20).rounded() / 20))
    }

    private static func resolvedSystemAudioLevel(
        persistedLevel: Double?,
        persistedMicrophoneLevel: Double?
    ) -> Double {
        let legacyDefaultLevel = 0.75
        let recommendedLevel = 0.60

        guard let persistedLevel else {
            return recommendedLevel
        }

        if persistedMicrophoneLevel == nil, abs(persistedLevel - legacyDefaultLevel) < 0.001 {
            return recommendedLevel
        }

        return normalizedSystemAudioLevel(persistedLevel)
    }

    private static func logTimestampString(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    private func persistSettingsSnapshot() {
        settingsStore.saveSettings(currentPersistedSettings())
    }

    private func refreshMicrophoneCaptureSuppression() {
        guard includeMicrophone else {
            microphoneCaptureSuppressed = false
            refreshVoiceCommandListenerState()
            return
        }

        if shouldPreventEchoBySuppressingMicrophone {
            if !microphoneCaptureSuppressed {
                statusText = "Loopback microphone + system audio can cause echo, so microphone capture was disabled automatically."
            }
            microphoneCaptureSuppressed = true
            refreshVoiceCommandListenerState()
            return
        }

        let authorizationStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        microphoneCaptureSuppressed = authorizationStatus != .authorized && microphoneCaptureSuppressed

        if authorizationStatus == .authorized {
            microphoneCaptureSuppressed = false
        }

        refreshVoiceCommandListenerState()
    }

    private func refreshVoiceCommandListenerState() {
        voiceCommandManager.setPreferredMicrophoneDeviceID(resolvedSelectedMicrophoneDeviceID)
        voiceCommandManager.setUsesExternalMicrophoneFeed(shouldUseRecorderMicrophoneFeedForVoiceCommands)
        if isRecording || includeMicrophone {
            voiceCommandManager.start()
        } else {
            voiceCommandManager.stop()
        }
    }

    private func currentPersistedSettings() -> PersistedAppSettings {
        PersistedAppSettings(
            clipDuration: Self.normalizedClipDuration(clipDuration),
            startReplayBufferOnLaunch: true,
            includeMicrophone: includeMicrophone,
            selectedMicrophoneID: selectedMicrophoneID.isEmpty ? nil : selectedMicrophoneID,
            captureSystemAudio: captureSystemAudio,
            systemAudioLevel: systemAudioLevel,
            microphoneAudioLevel: microphoneAudioLevel,
            showCursor: showCursor,
            enableGameNotifications: enableGameNotifications,
            captureResolutionPreset: captureResolutionPreset,
            videoQualityPreset: videoQualityPreset,
            appUUID: appUUID,
            websiteUserID: websiteUserID.isEmpty ? nil : websiteUserID,
            unlockedPaidFeatures: [],
            shortcutKey: shortcutKey.isEmpty ? "9" : shortcutKey,
            useCommand: useCommand,
            useShift: useShift,
            useOption: useOption,
            useControl: useControl,
            saveDirectoryPath: saveDirectoryPath,
            selectedCaptureDisplayID: selectedCaptureDisplayID,
            discordWebhookURLString: Self.lockedDiscordWebhookURL,
            base44Token: base44Token.isEmpty ? nil : base44Token,
            automaticallyChecksForUpdates: updater.automaticallyChecksForUpdates,
            checksForUpdatesOnLaunch: updater.checksForUpdatesOnLaunch,
            captureDeviceProfiles: captureDeviceProfiles,
            uploadedClipURLs: Array(uploadedClipURLs),
            hasCompletedOnboarding: hasCompletedOnboarding,
            lastSeenLaunchSetupVersion: Self.normalizedLaunchSetupVersion(lastSeenLaunchSetupVersion),
            hasAcknowledgedFourKProUnlock: hasAcknowledgedFourKProUnlock,
            customVoiceCommandPhrase: customVoiceCommandPhrase
        )
    }

    private static func loadCaptureDeviceProfiles(from defaults: UserDefaults) -> [String: CaptureDeviceSettingsProfile] {
        guard let data = defaults.data(forKey: captureDeviceProfilesKey),
              let profiles = try? JSONDecoder().decode([String: CaptureDeviceSettingsProfile].self, from: data) else {
            return [:]
        }

        return profiles
    }

    private static func loadPersistedSettings(
        from settingsStore: MachineSettingsStore,
        defaults: UserDefaults,
        defaultSaveDirectory: String
    ) -> PersistedAppSettings {
        if let storedSettings = settingsStore.loadSettings() {
            return PersistedAppSettings(
                clipDuration: normalizedClipDuration(storedSettings.clipDuration),
                startReplayBufferOnLaunch: true,
                includeMicrophone: storedSettings.includeMicrophone,
                selectedMicrophoneID: storedSettings.selectedMicrophoneID,
                captureSystemAudio: storedSettings.captureSystemAudio,
                systemAudioLevel: resolvedSystemAudioLevel(
                    persistedLevel: storedSettings.systemAudioLevel,
                    persistedMicrophoneLevel: storedSettings.microphoneAudioLevel
                ),
                microphoneAudioLevel: normalizedMicrophoneAudioLevel(storedSettings.microphoneAudioLevel ?? 1.0),
                showCursor: storedSettings.showCursor,
                enableGameNotifications: storedSettings.enableGameNotifications,
                captureResolutionPreset: storedSettings.captureResolutionPreset,
                videoQualityPreset: storedSettings.videoQualityPreset,
                appUUID: resolvedAppUUID(storedSettings.appUUID),
                websiteUserID: storedSettings.websiteUserID,
                unlockedPaidFeatures: [],
                shortcutKey: storedSettings.shortcutKey.isEmpty ? "9" : storedSettings.shortcutKey,
                useCommand: storedSettings.useCommand,
                useShift: storedSettings.useShift,
                useOption: storedSettings.useOption,
                useControl: storedSettings.useControl,
                saveDirectoryPath: storedSettings.saveDirectoryPath.isEmpty ? defaultSaveDirectory : storedSettings.saveDirectoryPath,
                selectedCaptureDisplayID: storedSettings.selectedCaptureDisplayID.isEmpty ? defaultCaptureDisplayID() : storedSettings.selectedCaptureDisplayID,
                discordWebhookURLString: Self.lockedDiscordWebhookURL,
                automaticallyChecksForUpdates: storedSettings.automaticallyChecksForUpdates,
                checksForUpdatesOnLaunch: storedSettings.checksForUpdatesOnLaunch ?? false,
                captureDeviceProfiles: storedSettings.captureDeviceProfiles,
                uploadedClipURLs: storedSettings.uploadedClipURLs,
                hasCompletedOnboarding: storedSettings.hasCompletedOnboarding,
                lastSeenLaunchSetupVersion: normalizedLaunchSetupVersion(storedSettings.lastSeenLaunchSetupVersion),
                hasAcknowledgedFourKProUnlock: storedSettings.hasAcknowledgedFourKProUnlock,
                customVoiceCommandPhrase: storedSettings.customVoiceCommandPhrase
            )
        }

        let migratedSettings = PersistedAppSettings(
            clipDuration: loadClipDuration(from: defaults),
            startReplayBufferOnLaunch: true,
            includeMicrophone: defaults.object(forKey: "includeMicrophone") as? Bool ?? false,
            selectedMicrophoneID: defaults.string(forKey: "selectedMicrophoneID"),
            captureSystemAudio: defaults.object(forKey: "captureSystemAudio") as? Bool ?? true,
            systemAudioLevel: resolvedSystemAudioLevel(
                persistedLevel: (defaults.object(forKey: "systemAudioLevel") as? NSNumber)?.doubleValue,
                persistedMicrophoneLevel: (defaults.object(forKey: "microphoneAudioLevel") as? NSNumber)?.doubleValue
            ),
            microphoneAudioLevel: normalizedMicrophoneAudioLevel((defaults.object(forKey: "microphoneAudioLevel") as? NSNumber)?.doubleValue ?? 1.0),
            showCursor: defaults.object(forKey: "showCursor") as? Bool ?? true,
            enableGameNotifications: defaults.object(forKey: "enableGameNotifications") as? Bool ?? true,
            captureResolutionPreset: CaptureResolutionPreset(rawValue: defaults.string(forKey: "captureResolutionPreset") ?? "automatic") ?? .automatic,
            videoQualityPreset: VideoQualityPreset(rawValue: defaults.string(forKey: "videoQualityPreset") ?? "performance") ?? .performance,
            appUUID: resolvedAppUUID(defaults.string(forKey: "appUUID")),
            websiteUserID: defaults.string(forKey: "websiteUserID"),
            unlockedPaidFeatures: [],
            shortcutKey: defaults.string(forKey: "shortcutKey") ?? "9",
            useCommand: defaults.object(forKey: "useCommand") as? Bool ?? true,
            useShift: defaults.object(forKey: "useShift") as? Bool ?? true,
            useOption: defaults.object(forKey: "useOption") as? Bool ?? false,
            useControl: defaults.object(forKey: "useControl") as? Bool ?? false,
            saveDirectoryPath: defaults.string(forKey: "saveDirectoryPath") ?? defaultSaveDirectory,
            selectedCaptureDisplayID: defaults.string(forKey: "selectedCaptureDisplayID") ?? defaultCaptureDisplayID(),
            discordWebhookURLString: Self.lockedDiscordWebhookURL,
            automaticallyChecksForUpdates: defaults.object(forKey: "automaticallyChecksForUpdates") as? Bool ?? true,
            checksForUpdatesOnLaunch: defaults.object(forKey: "checksForUpdatesOnLaunch") as? Bool ?? false,
            captureDeviceProfiles: loadCaptureDeviceProfiles(from: defaults),
            uploadedClipURLs: [],
            hasCompletedOnboarding: false,
            lastSeenLaunchSetupVersion: nil,
            hasAcknowledgedFourKProUnlock: nil,
            customVoiceCommandPhrase: nil
        )

        settingsStore.saveSettings(migratedSettings)
        return migratedSettings
    }

    private static func resolvedAppUUID(_ candidate: String?) -> String {
        let trimmedCandidate = (candidate ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if let parsedUUID = UUID(uuidString: trimmedCandidate) {
            return parsedUUID.uuidString.lowercased()
        }

        return UUID().uuidString.lowercased()
    }
}
