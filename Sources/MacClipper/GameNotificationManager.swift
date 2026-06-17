import SwiftUI
import AppKit
import QuickLookThumbnailing

enum GameNotificationTone {
    case standard
    case celebratory
}

struct GameNotificationAction: Identifiable {
    let id = UUID()
    let title: String
    let systemImage: String
    let tint: Color
    let handler: () -> Void
}

@MainActor
final class GameNotificationManager {
    static let shared = GameNotificationManager()

    private enum Layout {
        static let width: CGFloat = 430
        static let compactHeight: CGFloat = 104
        static let actionHeight: CGFloat = 138
    }

    private var panel: NSPanel?
    private var hideTask: DispatchWorkItem?

    private init() {}

    func show(
        title: String,
        message: String,
        sourceApp: ClipSourceApp?,
        previewURL: URL? = nil,
        actions: [GameNotificationAction] = [],
        tone: GameNotificationTone = .standard
    ) {
        hideTask?.cancel()

        Task { @MainActor [weak self] in
            guard let self else { return }
            let panel = ensurePanel()
            let previewImage = await Self.makePreviewImage(for: previewURL)
            let hasActionBar = !actions.isEmpty
            let panelHeight = hasActionBar ? Layout.actionHeight : Layout.compactHeight
            let contentView = NSHostingView(
                rootView: GameNotificationToastView(
                    title: title,
                    message: message,
                    sourceApp: sourceApp,
                    icon: GameNotificationAppIconProvider.icon(for: sourceApp, size: 30),
                    previewImage: previewImage,
                    actions: actions,
                    tone: tone
                )
            )
            contentView.translatesAutoresizingMaskIntoConstraints = false

            let container = NSView(frame: NSRect(x: 0, y: 0, width: Layout.width, height: panelHeight))
            container.wantsLayer = true
            container.addSubview(contentView)

            NSLayoutConstraint.activate([
                contentView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                contentView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                contentView.topAnchor.constraint(equalTo: container.topAnchor),
                contentView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
            ])

            panel.contentView = container
            panel.setContentSize(NSSize(width: Layout.width, height: panelHeight))
            position(panel)
            panel.alphaValue = 1
            panel.orderFrontRegardless()

            let task = DispatchWorkItem { [weak self] in
                self?.hideAnimated()
            }
            self.hideTask = task
            let displayDuration = hasActionBar ? 8.0 : (tone == .celebratory ? 5.2 : 3.0)
            DispatchQueue.main.asyncAfter(deadline: .now() + displayDuration, execute: task)
        }
    }

    private func ensurePanel() -> NSPanel {
        if let panel {
            return panel
        }

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 430, height: 104),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.ignoresMouseEvents = false
        panel.hidesOnDeactivate = false
        self.panel = panel
        return panel
    }

    private func position(_ panel: NSPanel) {
        let activeScreen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) })
            ?? NSScreen.main
            ?? NSScreen.screens.first

        guard let screen = activeScreen else { return }
        let visibleFrame = screen.visibleFrame
        let size = panel.frame.size
        let origin = NSPoint(
            x: visibleFrame.midX - (size.width / 2),
            y: visibleFrame.maxY - size.height - 18
        )
        panel.setFrameOrigin(origin)
    }

    private func hideAnimated() {
        guard let panel else { return }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            panel.animator().alphaValue = 0
        }

        NSObject.cancelPreviousPerformRequests(withTarget: panel, selector: #selector(NSWindow.orderOut(_:)), object: nil)
        panel.perform(#selector(NSWindow.orderOut(_:)), with: nil, afterDelay: 0.2)
    }

    private static func makePreviewImage(for clipURL: URL?) async -> NSImage? {
        guard let clipURL else { return nil }

        let request = QLThumbnailGenerator.Request(
            fileAt: clipURL,
            size: CGSize(width: 236, height: 132),
            scale: NSScreen.main?.backingScaleFactor ?? 2,
            representationTypes: .thumbnail
        )

        return await withCheckedContinuation { continuation in
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { thumbnail, error in
                if let cgImage = thumbnail?.cgImage {
                    continuation.resume(
                        returning: NSImage(
                            cgImage: cgImage,
                            size: NSSize(width: cgImage.width, height: cgImage.height)
                        )
                    )
                } else {
                    if let error {
                        NSLog("MacClipper preview thumbnail failed: \(error.localizedDescription)")
                    }
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}

private struct GameNotificationToastView: View {
    let title: String
    let message: String
    let sourceApp: ClipSourceApp?
    let icon: NSImage?
    let previewImage: NSImage?
    let actions: [GameNotificationAction]
    let tone: GameNotificationTone

    private var isCelebratory: Bool {
        tone == .celebratory
    }

    private var accentColor: Color {
        isCelebratory
            ? Color(red: 0.97, green: 0.70, blue: 0.18)
            : Color(red: 0.03, green: 0.60, blue: 0.98)
    }

    private var backgroundStyle: AnyShapeStyle {
        if isCelebratory {
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color(red: 1.00, green: 0.97, blue: 0.87),
                        Color(red: 1.00, green: 0.92, blue: 0.78)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        }

        return AnyShapeStyle(Color(red: 0.97, green: 0.97, blue: 0.98))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isCelebratory {
                Text("PRO UNLOCKED")
                    .font(.system(size: 10, weight: .black))
                    .kerning(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                        Color.white.opacity(0.9),
                        in: Capsule(style: .continuous)
                    )
                    .foregroundStyle(Color(red: 0.52, green: 0.31, blue: 0.00))
            }

            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(accentColor)
                    .frame(width: 5)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 10) {
                        Group {
                            if let icon {
                                Image(nsImage: icon)
                                    .resizable()
                                    .scaledToFit()
                            } else if isCelebratory {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 16, weight: .black))
                                    .foregroundStyle(accentColor)
                            } else {
                                Image(systemName: "bell.fill")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color(red: 0.12, green: 0.14, blue: 0.18))
                            }
                        }
                        .frame(width: 22, height: 22)
                        .padding(7)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 8))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(sourceApp?.name ?? "MacClipper")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.black.opacity(0.68))
                                .lineLimit(1)

                            Text(title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(isCelebratory ? Color(red: 0.39, green: 0.19, blue: 0.00) : Color(red: 0.10, green: 0.11, blue: 0.14))
                                .lineLimit(1)
                        }
                    }

                    Text(message)
                        .font(.system(size: 13))
                        .foregroundStyle(isCelebratory ? Color(red: 0.34, green: 0.24, blue: 0.08) : Color.black.opacity(0.72))
                        .lineLimit(isCelebratory ? 3 : 2)
                }

                Spacer(minLength: 0)

                if let previewImage {
                    Image(nsImage: previewImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 96, height: 54)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(Color.black.opacity(0.08), lineWidth: 1)
                        )
                }
            }

            if !actions.isEmpty {
                HStack(spacing: 8) {
                    ForEach(actions) { action in
                        Button(action: action.handler) {
                            NotificationActionChip(title: action.title, systemImage: action.systemImage, tint: action.tint, prominent: action.title == "Share")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(width: 430, alignment: .leading)
        .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(isCelebratory ? accentColor.opacity(0.45) : Color.black.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: isCelebratory ? accentColor.opacity(0.28) : .black.opacity(0.16), radius: 16, y: 8)
    }
}

private struct NotificationActionChip: View {
    let title: String
    let systemImage: String
    let tint: Color
    let prominent: Bool

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(prominent ? Color.white : tint)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                Capsule(style: .continuous)
                    .fill(prominent ? AnyShapeStyle(LinearGradient(colors: [tint, tint.opacity(0.72)], startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(tint.opacity(0.14)))
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(tint.opacity(prominent ? 0.0 : 0.26), lineWidth: 1)
            )
    }
}

@MainActor
private enum GameNotificationAppIconProvider {
    static func icon(for sourceApp: ClipSourceApp?, size: CGFloat) -> NSImage? {
        guard let sourceApp,
              let bundleIdentifier = sourceApp.bundleIdentifier,
              let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            return MacClipperIconAsset.image(size: size)
        }

        let icon = NSWorkspace.shared.icon(forFile: appURL.path)
        icon.size = NSSize(width: size, height: size)
        return icon
    }
}
