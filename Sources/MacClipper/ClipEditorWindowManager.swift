import AppKit
import SwiftUI

@MainActor
final class ClipEditorWindowManager: NSObject, NSWindowDelegate {
    private weak var model: AppModel?
    private var window: NSWindow?

    init(model: AppModel) {
        self.model = model
    }

    func present() {
        let window = window ?? makeWindow()
        self.window = window

        if let model {
            let rootView = AnyView(
                ClipEditorWindowView()
                    .environmentObject(model)
            )
            (window.contentViewController as? NSHostingController<AnyView>)?.rootView = rootView
        }

        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
    }

    private func makeWindow() -> NSWindow {
        let rootView = AnyView(
            Group {
                if let model {
                    ClipEditorWindowView()
                        .environmentObject(model)
                } else {
                    Text("MacClipper Editor is unavailable right now.")
                        .padding(24)
                }
            }
        )

        let hostingController = NSHostingController(rootView: rootView)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1540, height: 980),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        window.contentViewController = hostingController
        window.title = "MacClipper Editor"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        window.toolbarStyle = .unifiedCompact
        window.titleVisibility = .visible
        return window
    }
}