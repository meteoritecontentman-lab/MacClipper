import SwiftUI
import AppKit
import StoreKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    nonisolated static let deepLinkNotification = Notification.Name("MacClipperDeepLinkNotification")
    nonisolated static let deepLinkUserInfoKey = "urls"

    private let discordRichPresenceManager = DiscordRichPresenceManager()
    private let model = AppModel()
    private var menuBarStatusItemController: MenuBarStatusItemController?
    private static var pendingIncomingURLs: [URL] = []

    var appModel: AppModel {
        model
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        AppLogger.shared.log("App", "applicationDidFinishLaunching bundle=\(Bundle.main.bundleURL.path)")
        AppLogger.shared.log("App", "activationPolicy=regular dockIconEnabled=true mainLog=\(AppLogger.shared.logFileURL.path)")
        menuBarStatusItemController = MenuBarStatusItemController(model: model)
        AppIntegrityMonitor.verifyCurrentAppBundleAtLaunch()
        discordRichPresenceManager.start()
        refreshReceipt()
    }

    private func refreshReceipt() {
        let request = SKReceiptRefreshRequest()
        request.delegate = self
        request.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        AppLogger.shared.log("App", "applicationWillTerminate")
        menuBarStatusItemController?.invalidate()
        discordRichPresenceManager.stop()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        let joinedURLs = urls.map(\.absoluteString).joined(separator: ",")
        AppLogger.shared.log("DeepLink", "open urls=\(joinedURLs)")
        NotificationCenter.default.post(
            name: Self.deepLinkNotification,
            object: nil,
            userInfo: [Self.deepLinkUserInfoKey: urls]
        )
    }

    func application(_ application: NSApplication, openFile filename: String) -> Bool {
        AppLogger.shared.log("App", "openFile path=\(filename)")
        let url = URL(fileURLWithPath: filename)
        NotificationCenter.default.post(
            name: Self.deepLinkNotification,
            object: nil,
            userInfo: [Self.deepLinkUserInfoKey: [url]]
        )
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }

    static func takePendingIncomingURLs() -> [URL] {
        let urls = pendingIncomingURLs
        pendingIncomingURLs = []
        return urls
    }
}

extension AppDelegate: SKRequestDelegate {
    nonisolated func requestDidFinish(_ request: SKRequest) {
        guard let receiptURL = Bundle.main.appStoreReceiptURL,
              FileManager.default.fileExists(atPath: receiptURL.path) else {
            Task { @MainActor in
                AppLogger.shared.log("Receipt", "No App Store receipt found")
            }
            return
        }
        Task { @MainActor in
            AppLogger.shared.log("Receipt", "App Store receipt validated at \(receiptURL.path)")
        }
    }

    nonisolated func request(_ request: SKRequest, didFailWithError error: Error) {
        Task { @MainActor in
            AppLogger.shared.log("Receipt", "Receipt refresh failed: \(error.localizedDescription)")
        }
    }
}