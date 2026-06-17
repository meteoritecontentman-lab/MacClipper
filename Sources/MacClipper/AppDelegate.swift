import SwiftUI
import AppKit

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
