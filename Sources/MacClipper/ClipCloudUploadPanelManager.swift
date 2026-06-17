import AppKit
import SwiftUI

@MainActor
final class ClipCloudUploadPanelManager {
    static let shared = ClipCloudUploadPanelManager()

    private var panel: NSPanel?

    private init() {}

    func showUploading(clipName: String) {
        let panel = ensurePanel()
        panel.contentView = NSHostingView(
            rootView: AnyView(
                ClipCloudUploadPanelView(
                    title: "Uploading to Cloud",
                    subtitle: clipName,
                    detail: "MacClipper is creating the clip page now.",
                    content: AnyView(
                        VStack(spacing: 14) {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .scaleEffect(1.15)

                            Text("This stays inside MacClipper while the link is being prepared.")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    ),
                    primaryAction: nil,
                    secondaryAction: PanelAction(title: "Hide") { [weak self] in
                        self?.close()
                    }
                )
            )
        )
        present(panel)
    }

    func showSuccess(clipName: String, sharedURL: URL) {
        let panel = ensurePanel()
        panel.contentView = NSHostingView(
            rootView: AnyView(
                ClipCloudUploadPanelView(
                    title: "Clip page is live",
                    subtitle: clipName,
                    detail: sharedURL.absoluteString,
                    content: AnyView(
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundStyle(MacClipperTheme.success)

                            Text("MacClipper created the clip page. Copy the link or open it when you are ready.")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    ),
                    primaryAction: PanelAction(title: "Copy Link") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(sharedURL.absoluteString, forType: .string)
                    },
                    secondaryAction: PanelAction(title: "Done") { [weak self] in
                        self?.close()
                    },
                    tertiaryAction: PanelAction(title: "Open Page") {
                        NSWorkspace.shared.open(sharedURL)
                    }
                )
            )
        )
        present(panel)
    }

    func showFailure(clipName: String, message: String) {
        let panel = ensurePanel()
        panel.contentView = NSHostingView(
            rootView: AnyView(
                ClipCloudUploadPanelView(
                    title: "Cloud upload failed",
                    subtitle: clipName,
                    detail: message,
                    content: AnyView(
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundStyle(MacClipperTheme.sand)

                            Text("MacClipper could not finish the upload this time.")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    ),
                    primaryAction: nil,
                    secondaryAction: PanelAction(title: "Close") { [weak self] in
                        self?.close()
                    }
                )
            )
        )
        present(panel)
    }

    private func ensurePanel() -> NSPanel {
        if let panel {
            return panel
        }

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 240),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.title = "MacClipper Cloud"
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.level = .modalPanel
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        self.panel = panel
        return panel
    }

    private func present(_ panel: NSPanel) {
        panel.setContentSize(NSSize(width: 360, height: 240))
        position(panel)
        panel.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func position(_ panel: NSPanel) {
        let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) })
            ?? NSScreen.main
            ?? NSScreen.screens.first

        guard let screen else { return }
        let visibleFrame = screen.visibleFrame
        let size = panel.frame.size
        panel.setFrameOrigin(
            NSPoint(
                x: visibleFrame.midX - (size.width / 2),
                y: visibleFrame.midY - (size.height / 2)
            )
        )
    }

    private func close() {
        panel?.orderOut(nil)
    }
}

private struct PanelAction {
    let title: String
    let action: () -> Void
}

private struct ClipCloudUploadPanelView: View {
    let title: String
    let subtitle: String
    let detail: String
    let content: AnyView
    let primaryAction: PanelAction?
    let secondaryAction: PanelAction?
    let tertiaryAction: PanelAction?

    init(
        title: String,
        subtitle: String,
        detail: String,
        content: AnyView,
        primaryAction: PanelAction?,
        secondaryAction: PanelAction?,
        tertiaryAction: PanelAction? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.detail = detail
        self.content = content
        self.primaryAction = primaryAction
        self.secondaryAction = secondaryAction
        self.tertiaryAction = tertiaryAction
    }

    var body: some View {
        ZStack {
            MacClipperBackdrop()

            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 22, weight: .bold, design: .rounded))

                    Text(subtitle)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                MacClipperSurface(cornerRadius: 22, padding: 18) {
                    VStack(spacing: 16) {
                        content

                        Text(detail)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity)
                    }
                }

                HStack(spacing: 10) {
                    if let tertiaryAction {
                        Button(tertiaryAction.title, action: tertiaryAction.action)
                            .buttonStyle(MacClipperSecondaryButtonStyle())
                    }

                    Spacer(minLength: 0)

                    if let secondaryAction {
                        Button(secondaryAction.title, action: secondaryAction.action)
                            .buttonStyle(MacClipperSecondaryButtonStyle())
                    }

                    if let primaryAction {
                        Button(primaryAction.title, action: primaryAction.action)
                            .buttonStyle(MacClipperPrimaryButtonStyle())
                    }
                }
            }
            .padding(18)
        }
        .frame(width: 360, height: 240)
    }
}