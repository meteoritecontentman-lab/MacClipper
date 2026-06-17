import SwiftUI
import AppKit

private struct ShareTargetApp: Identifiable {
    let appURL: URL
    let name: String
    let icon: NSImage?

    var id: String { appURL.path }
}

@MainActor
final class ClipSharePanelManager {
    static let shared = ClipSharePanelManager()

    private var panel: NSPanel?
    private var sharingPicker: NSSharingServicePicker?

    private init() {}

    func show(
        clipURL: URL,
        discordConnected: Bool,
        onCloud: @escaping () -> Void,
        onDiscordChannel: @escaping () -> Void,
        onDiscordDM: @escaping () -> Void,
        onOther: @escaping () -> Void
    ) {
        let panel = ensurePanel()
        let apps = availableApps(for: clipURL)

        let contentView = NSHostingView(
            rootView: ClipSharePanelView(
                discordConnected: discordConnected,
                apps: apps,
                onCloud: { [weak self] in
                    onCloud()
                    self?.close()
                },
                onDiscordChannel: { [weak self] in
                    onDiscordChannel()
                    self?.close()
                },
                onDiscordDM: { [weak self] in
                    onDiscordDM()
                    self?.close()
                },
                onOpenApp: { [weak self] app in
                    self?.open(clipURL: clipURL, with: app)
                    self?.close()
                },
                onOther: { [weak self] in
                    onOther()
                    self?.showSystemSharePicker(for: clipURL, from: panel)
                },
                onClose: { [weak self] in
                    self?.close()
                }
            )
        )
        contentView.translatesAutoresizingMaskIntoConstraints = false

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 380))
        container.wantsLayer = true
        container.addSubview(contentView)

        NSLayoutConstraint.activate([
            contentView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            contentView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            contentView.topAnchor.constraint(equalTo: container.topAnchor),
            contentView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])

        panel.contentView = container
    panel.setContentSize(NSSize(width: 420, height: 380))
        position(panel)
        panel.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func ensurePanel() -> NSPanel {
        if let panel {
            return panel
        }

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 380),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.title = "Share Clip"
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.level = .modalPanel
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        self.panel = panel
        return panel
    }

    private func position(_ panel: NSPanel) {
        let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) })
            ?? NSScreen.main
            ?? NSScreen.screens.first

        guard let screen else { return }
        let visibleFrame = screen.visibleFrame
        let size = panel.frame.size
        let origin = NSPoint(
            x: visibleFrame.midX - (size.width / 2),
            y: visibleFrame.midY - (size.height / 2)
        )
        panel.setFrameOrigin(origin)
    }

    private func close() {
        panel?.orderOut(nil)
    }

    private func availableApps(for clipURL: URL) -> [ShareTargetApp] {
        let urls = NSWorkspace.shared.urlsForApplications(toOpen: clipURL)
        let currentBundleID = Bundle.main.bundleIdentifier

        var seenPaths = Set<String>()
        return urls.compactMap { appURL in
            let bundle = Bundle(url: appURL)
            let bundleID = bundle?.bundleIdentifier

            guard bundleID != currentBundleID else { return nil }
            guard seenPaths.insert(appURL.path).inserted else { return nil }

            let name = FileManager.default.displayName(atPath: appURL.path)
            guard !name.lowercased().contains("discord") else { return nil }

            let icon = NSWorkspace.shared.icon(forFile: appURL.path)
            icon.size = NSSize(width: 32, height: 32)
            return ShareTargetApp(appURL: appURL, name: name, icon: icon)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        .prefix(6)
        .map { $0 }
    }

    private func open(clipURL: URL, with app: ShareTargetApp) {
        let configuration = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.open([clipURL], withApplicationAt: app.appURL, configuration: configuration) { _, error in
            if let error {
                NSLog("MacClipper open-with app failed: \(error.localizedDescription)")
            }
        }
    }

    private func showSystemSharePicker(for clipURL: URL, from panel: NSPanel) {
        guard let contentView = panel.contentView else { return }
        let picker = NSSharingServicePicker(items: [clipURL])
        sharingPicker = picker
        picker.show(relativeTo: contentView.bounds, of: contentView, preferredEdge: .minY)
    }
}

private struct ClipSharePanelView: View {
    let discordConnected: Bool
    let apps: [ShareTargetApp]
    let onCloud: () -> Void
    let onDiscordChannel: () -> Void
    let onDiscordDM: () -> Void
    let onOpenApp: (ShareTargetApp) -> Void
    let onOther: () -> Void
    let onClose: () -> Void

    var body: some View {
        ZStack {
            MacClipperBackdrop()

            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Share Clip")
                            .font(.system(size: 24, weight: .bold, design: .rounded))

                        Text("Pick a fast path for this clip without dropping back into Finder.")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 0)

                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.secondary)
                            .padding(8)
                            .background(.white.opacity(0.22), in: Circle())
                    }
                    .buttonStyle(.plain)
                }

                MacClipperSurface(cornerRadius: 20, padding: 14) {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        ShareChoiceTile(
                            title: "Cloud",
                            subtitle: "Create a link instantly and copy it",
                            systemImage: "cloud.fill",
                            tint: MacClipperTheme.cyan,
                            action: onCloud
                        )

                        ShareChoiceTile(
                            title: "Post Online",
                            subtitle: discordConnected ? "Send straight to your locked public feed" : "This build is missing its public post target",
                            systemImage: "paperplane.fill",
                            tint: MacClipperTheme.cyan,
                            action: onDiscordChannel
                        )

                        ShareChoiceTile(
                            title: "Post + Open Discord",
                            subtitle: discordConnected ? "Post it, copy the link, then jump into Discord" : "This build is missing its public post target",
                            systemImage: "bubble.left.and.bubble.right.fill",
                            tint: MacClipperTheme.success,
                            action: onDiscordDM
                        )

                        ShareChoiceTile(
                            title: "Other",
                            subtitle: "Open the macOS share sheet",
                            systemImage: "square.and.arrow.up",
                            tint: MacClipperTheme.sand,
                            action: onOther
                        )
                    }
                }

                Text("Other Apps")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(apps) { app in
                        Button {
                            onOpenApp(app)
                        } label: {
                            ShareAppTile(app: app)
                        }
                        .buttonStyle(.plain)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(18)
        }
        .frame(width: 420, height: 380)
    }
}

private struct ShareChoiceTile: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(tint)

                Text(title)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)

                Text(subtitle)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.white.opacity(0.16))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct ShareAppTile: View {
    let app: ShareTargetApp

    var body: some View {
        HStack(spacing: 10) {
            if let icon = app.icon {
                Image(nsImage: icon)
                    .resizable()
                    .frame(width: 28, height: 28)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            } else {
                Image(systemName: "app.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(MacClipperTheme.cyan)
                    .frame(width: 28, height: 28)
                    .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }

            Text(app.name)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.white.opacity(0.16))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}