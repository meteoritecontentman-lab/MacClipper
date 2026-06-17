import AppKit
import Foundation

private struct RemovalTarget: Hashable {
    let url: URL
    let title: String
}

@MainActor
final class MacClipperUninstallerDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        runUninstallFlow()
    }

    private func runUninstallFlow() {
        NSApp.activate(ignoringOtherApps: true)

        let existingTargets = Self.removalTargets().filter { FileManager.default.fileExists(atPath: $0.url.path) }
        guard !existingTargets.isEmpty else {
            presentAlert(
                title: "Nothing to Remove",
                message: "MacClipper is not installed in the usual locations on this Mac."
            )
            NSApp.terminate(nil)
            return
        }

        let confirmation = NSAlert()
        confirmation.alertStyle = .warning
        confirmation.messageText = "Uninstall MacClipper?"
        confirmation.informativeText = "This removes MacClipper, MacClipper Dev, local settings, logs, caches, and saved clips from this Mac."
        confirmation.addButton(withTitle: "Uninstall")
        confirmation.addButton(withTitle: "Cancel")

        guard confirmation.runModal() == .alertFirstButtonReturn else {
            NSApp.terminate(nil)
            return
        }

        terminateRunningMacClipperApps()

        var removedTitles: [String] = []
        var failures: [String] = []

        for target in existingTargets {
            do {
                try FileManager.default.removeItem(at: target.url)
                removedTitles.append(target.title)
            } catch {
                failures.append("\(target.title): \(error.localizedDescription)")
            }
        }

        if failures.isEmpty {
            presentAlert(
                title: "MacClipper Removed",
                message: removedTitles.isEmpty
                    ? "There was nothing left to remove."
                    : "Removed \(removedTitles.count) MacClipper items from this Mac."
            )
        } else {
            presentAlert(
                title: "Uninstall Finished with Errors",
                message: failures.joined(separator: "\n")
            )
        }

        NSApp.terminate(nil)
    }

    private func presentAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private func terminateRunningMacClipperApps() {
        let bundleIdentifiers = [
            "local.macclipper.app",
            "local.macclipper.dev"
        ]

        for bundleIdentifier in bundleIdentifiers {
            for app in NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier) {
                app.forceTerminate()
            }
        }

        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
    }

    private static func removalTargets() -> [RemovalTarget] {
        let homeDirectory = FileManager.default.homeDirectoryForCurrentUser
        let siblingDirectory = Bundle.main.bundleURL.deletingLastPathComponent()

        return [
            RemovalTarget(url: URL(fileURLWithPath: "/Applications/MacClipper.app"), title: "Applications/MacClipper.app"),
            RemovalTarget(url: URL(fileURLWithPath: "/Applications/MacClipper Dev.app"), title: "Applications/MacClipper Dev.app"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Applications/MacClipper.app"), title: "~/Applications/MacClipper.app"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Applications/MacClipper Dev.app"), title: "~/Applications/MacClipper Dev.app"),
            RemovalTarget(url: siblingDirectory.appendingPathComponent("MacClipper.app"), title: "Sibling MacClipper.app"),
            RemovalTarget(url: siblingDirectory.appendingPathComponent("MacClipper Dev.app"), title: "Sibling MacClipper Dev.app"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Application Support/MacClipper", isDirectory: true), title: "Application Support"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Application Support/MacClipper Dev", isDirectory: true), title: "Developer Application Support"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Logs/MacClipper", isDirectory: true), title: "Logs"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Caches/MacClipper", isDirectory: true), title: "Caches"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Caches/local.macclipper.app", isDirectory: true), title: "Bundle Cache"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Caches/local.macclipper.dev", isDirectory: true), title: "Developer Bundle Cache"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Preferences/local.macclipper.app.plist"), title: "Preferences"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Library/Preferences/local.macclipper.dev.plist"), title: "Developer Preferences"),
            RemovalTarget(url: homeDirectory.appendingPathComponent("Movies/MacClipper", isDirectory: true), title: "Saved Clips")
        ]
    }
}

@main
struct MacClipperUninstallerApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = MacClipperUninstallerDelegate()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
    }
}