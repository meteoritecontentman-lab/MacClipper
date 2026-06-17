import Foundation
import AppKit
import Sparkle

struct AvailableAppcastUpdate: Equatable {
    let displayVersion: String
    let buildVersion: String
}

@MainActor
final class UpdaterManager: NSObject, ObservableObject {
    @Published var automaticallyChecksForUpdates: Bool {
        didSet {
            guard !isSynchronizingAutomaticChecks else { return }
            guard automaticallyChecksForUpdates != updater.automaticallyChecksForUpdates else { return }

            updater.automaticallyChecksForUpdates = automaticallyChecksForUpdates
            persistUpdatePreferences()
        }
    }

    @Published var checksForUpdatesOnLaunch: Bool {
        didSet {
            guard checksForUpdatesOnLaunch != oldValue else { return }
            persistUpdatePreferences()
        }
    }

    @Published private(set) var feedURLString: String
    @Published private(set) var isChecking = false
    @Published private(set) var statusText: String
    @Published private(set) var availableUpdate: AvailableAppcastUpdate?
    @Published private(set) var isUpdaterEnabled: Bool

    private let defaults = UserDefaults.standard
    private let settingsStore: MachineSettingsStore?

    private var canCheckObservation: NSKeyValueObservation?
    private var automaticChecksObservation: NSKeyValueObservation?
    private var isSynchronizingAutomaticChecks = false
    private var didScheduleLaunchCheck = false

    private static let hostedAppcastURLString = "https://raw.githubusercontent.com/Userbro20/macclip-auto-update/main/appcast.xml"
    private static let legacyAutomaticChecksKey = "automaticallyChecksForUpdates"
    private static let launchCheckPreferenceKey = "checksForUpdatesOnLaunch"
    private static let sparkleSettingsMigratedKey = "sparkleUpdaterSettingsMigrated"
    private static let launchCheckDelay: TimeInterval = 0.8
    private static let maxLaunchCheckAttempts = 6

    private lazy var updaterController = SPUStandardUpdaterController(
        startingUpdater: false,
        updaterDelegate: self,
        userDriverDelegate: self
    )

    private var updater: SPUUpdater {
        updaterController.updater
    }

    init(
        automaticallyChecksForUpdates initialAutomaticallyChecksForUpdates: Bool? = nil,
        checksForUpdatesOnLaunch initialChecksForUpdatesOnLaunch: Bool? = nil,
        settingsStore: MachineSettingsStore? = nil
    ) {
        self.settingsStore = settingsStore
        self.automaticallyChecksForUpdates = initialAutomaticallyChecksForUpdates ?? true
        self.checksForUpdatesOnLaunch = initialChecksForUpdatesOnLaunch ?? true

        let configuredFeedURL = (Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let updaterEnabled = (Bundle.main.object(forInfoDictionaryKey: "MacClipperEnableUpdater") as? Bool) ?? true
        isUpdaterEnabled = updaterEnabled
        feedURLString = (configuredFeedURL?.isEmpty == false) ? configuredFeedURL! : Self.hostedAppcastURLString
        statusText = updaterEnabled ? "Sparkle ready" : "Updater disabled in this build"
        availableUpdate = nil

        super.init()

        guard updaterEnabled else {
            automaticallyChecksForUpdates = false
            checksForUpdatesOnLaunch = false
            persistUpdatePreferences()
            return
        }

        migrateLegacyAutomaticChecksIfNeeded(using: initialAutomaticallyChecksForUpdates)
        installObservers()
        startUpdater()
        enforceRequiredUpdateBehavior()
        scheduleLaunchUpdateCheckIfNeeded()
        synchronizeFromUpdater()
    }

    deinit {
        canCheckObservation?.invalidate()
        automaticChecksObservation?.invalidate()
    }

    var currentVersionDescription: String {
        "v\(currentVersionString) (build \(currentBuildNumber))"
    }

    var canCheckForUpdates: Bool {
        isUpdaterEnabled && updater.canCheckForUpdates
    }

    var checkForUpdatesButtonTitle: String {
        isChecking ? "Checking…" : "Check for Updates"
    }

    func savePreferences() {
        persistUpdatePreferences()
    }

    func checkForUpdates() {
        guard isUpdaterEnabled else {
            statusText = "Updater disabled in this build"
            return
        }

        guard updater.canCheckForUpdates else { return }

        availableUpdate = nil
        statusText = "Checking for updates…"
        updaterController.checkForUpdates(nil)
    }

    func openAvailableUpdate() {
        checkForUpdates()
    }

    private func startUpdater() {
        updaterController.startUpdater()
    }

    private func enforceRequiredUpdateBehavior() {
        if !updater.automaticallyChecksForUpdates {
            updater.automaticallyChecksForUpdates = true
        }

        if !automaticallyChecksForUpdates {
            automaticallyChecksForUpdates = true
        }

        if !checksForUpdatesOnLaunch {
            checksForUpdatesOnLaunch = true
        }

        persistUpdatePreferences()
    }

    private func installObservers() {
        canCheckObservation = updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] updater, change in
            Task { @MainActor [weak self] in
                guard let self else { return }

                let canCheck = change.newValue ?? updater.canCheckForUpdates
                let isCurrentlyChecking = !canCheck
                if self.isChecking != isCurrentlyChecking {
                    self.isChecking = isCurrentlyChecking
                }

                if canCheck, self.statusText == "Checking for updates…", self.availableUpdate == nil {
                    self.statusText = "Sparkle ready"
                }
            }
        }

        automaticChecksObservation = updater.observe(\.automaticallyChecksForUpdates, options: [.initial, .new]) { [weak self] updater, change in
            Task { @MainActor [weak self] in
                guard let self else { return }

                let newValue = change.newValue ?? updater.automaticallyChecksForUpdates
                guard self.automaticallyChecksForUpdates != newValue else { return }

                self.isSynchronizingAutomaticChecks = true
                self.automaticallyChecksForUpdates = newValue
                self.isSynchronizingAutomaticChecks = false
                self.persistUpdatePreferences()
            }
        }
    }

    private func synchronizeFromUpdater() {
        guard isUpdaterEnabled else {
            isChecking = false
            return
        }

        if let resolvedFeedURL = updater.feedURL?.absoluteString,
           !resolvedFeedURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            feedURLString = resolvedFeedURL
        }

        isSynchronizingAutomaticChecks = true
        automaticallyChecksForUpdates = updater.automaticallyChecksForUpdates
        isSynchronizingAutomaticChecks = false
        isChecking = !updater.canCheckForUpdates
    }

    private func migrateLegacyAutomaticChecksIfNeeded(using initialAutomaticChecksForUpdates: Bool?) {
        guard isUpdaterEnabled else { return }
        guard !defaults.bool(forKey: Self.sparkleSettingsMigratedKey) else { return }

        let legacyPreference = defaults.object(forKey: Self.legacyAutomaticChecksKey) as? Bool
            ?? initialAutomaticChecksForUpdates

        if let legacyPreference {
            updater.automaticallyChecksForUpdates = legacyPreference
        }

        defaults.set(true, forKey: Self.sparkleSettingsMigratedKey)
        persistUpdatePreferences()
    }

    private func persistUpdatePreferences() {
        defaults.set(automaticallyChecksForUpdates, forKey: Self.legacyAutomaticChecksKey)
        defaults.set(checksForUpdatesOnLaunch, forKey: Self.launchCheckPreferenceKey)
        settingsStore?.updateSettings { settings in
            settings.automaticallyChecksForUpdates = automaticallyChecksForUpdates
            settings.checksForUpdatesOnLaunch = checksForUpdatesOnLaunch
        }
    }

    private func scheduleLaunchUpdateCheckIfNeeded() {
        guard isUpdaterEnabled else { return }
        guard checksForUpdatesOnLaunch, !didScheduleLaunchCheck else { return }

        didScheduleLaunchCheck = true
        availableUpdate = nil
        statusText = "Checking for updates…"
        scheduleLaunchUpdateCheckAttempt(remainingAttempts: Self.maxLaunchCheckAttempts)
    }

    private func scheduleLaunchUpdateCheckAttempt(remainingAttempts: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.launchCheckDelay) { [weak self] in
            self?.performLaunchUpdateCheck(remainingAttempts: remainingAttempts)
        }
    }

    private func performLaunchUpdateCheck(remainingAttempts: Int) {
        guard isUpdaterEnabled else { return }
        guard didScheduleLaunchCheck else { return }

        if updater.canCheckForUpdates {
            statusText = "Checking for updates…"
            updater.checkForUpdatesInBackground()
            return
        }

        guard remainingAttempts > 0 else {
            statusText = "Sparkle ready"
            return
        }

        scheduleLaunchUpdateCheckAttempt(remainingAttempts: remainingAttempts - 1)
    }

    private func bringUpdateUIToFront() {
        NSApp.unhide(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSRunningApplication.current.activate(options: [.activateAllWindows])

        DispatchQueue.main.async {
            for window in NSApp.windows where window.isVisible {
                window.orderFrontRegardless()
            }
        }
    }

    private func updateAvailableState(using item: SUAppcastItem) {
        guard isUpdaterEnabled else { return }
        availableUpdate = AvailableAppcastUpdate(
            displayVersion: displayVersion(for: item),
            buildVersion: item.versionString
        )
    }

    private func displayVersion(for item: SUAppcastItem) -> String {
        let resolvedDisplayVersion = item.displayVersionString.trimmingCharacters(in: .whitespacesAndNewlines)
        return resolvedDisplayVersion.isEmpty ? item.versionString : resolvedDisplayVersion
    }

    private var currentVersionString: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "1.0"
    }

    private var currentBuildNumber: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? "1"
    }
}

extension UpdaterManager: SPUUpdaterDelegate {
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        guard isUpdaterEnabled else { return }
        updateAvailableState(using: item)
        statusText = "Update \(displayVersion(for: item)) is available"
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        guard isUpdaterEnabled else { return }
        availableUpdate = nil
        statusText = "MacClipper is up to date"
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) {
        guard isUpdaterEnabled else { return }
        availableUpdate = nil
        statusText = "MacClipper is up to date"
    }

    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
        guard isUpdaterEnabled else { return }
        updateAvailableState(using: item)
        statusText = "Downloading update \(displayVersion(for: item))…"
    }

    func updater(_ updater: SPUUpdater, didDownloadUpdate item: SUAppcastItem) {
        guard isUpdaterEnabled else { return }
        updateAvailableState(using: item)
        statusText = "Update \(displayVersion(for: item)) is ready"
    }

    func updater(_ updater: SPUUpdater, willExtractUpdate item: SUAppcastItem) {
        guard isUpdaterEnabled else { return }
        updateAvailableState(using: item)
        statusText = "Preparing update \(displayVersion(for: item))…"
    }

    func updater(_ updater: SPUUpdater, didExtractUpdate item: SUAppcastItem) {
        guard isUpdaterEnabled else { return }
        updateAvailableState(using: item)
        statusText = "Update \(displayVersion(for: item)) is ready to install"
    }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        guard isUpdaterEnabled else { return }
        updateAvailableState(using: item)
        statusText = "Installing update \(displayVersion(for: item))…"
    }

    func updaterWillRelaunchApplication(_ updater: SPUUpdater) {
        guard isUpdaterEnabled else { return }
        statusText = "Restarting to finish the update…"
    }

    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        guard isUpdaterEnabled else { return }
        availableUpdate = nil
        statusText = error.localizedDescription
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        guard isUpdaterEnabled else { return }
        if let error {
            statusText = error.localizedDescription
            availableUpdate = nil
        } else if availableUpdate == nil, statusText == "Checking for updates…" {
            statusText = "MacClipper is up to date"
        }
    }
}

extension UpdaterManager: SPUStandardUserDriverDelegate {
    nonisolated func standardUserDriverWillShowModalAlert() {
        Task { @MainActor [weak self] in
            guard let self, self.isUpdaterEnabled else { return }
            self.bringUpdateUIToFront()
        }
    }

    nonisolated func standardUserDriverDidShowModalAlert() {
        Task { @MainActor [weak self] in
            guard let self, self.isUpdaterEnabled else { return }
            self.bringUpdateUIToFront()
        }
    }

    nonisolated func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        Task { @MainActor [weak self] in
            guard let self, self.isUpdaterEnabled else { return }
            self.bringUpdateUIToFront()
        }
    }
}
