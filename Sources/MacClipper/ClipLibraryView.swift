import SwiftUI
import AVKit
import AppKit

struct ClipLibraryView: View {
    @EnvironmentObject private var model: AppModel
    @State private var player = AVPlayer()
    @State private var showEditorAccessPopover = false
    @State private var playerError: String?

    var body: some View {
        Group {
            if #available(macOS 13.0, *) {
                NavigationSplitView {
                    sidebarContent
                        .navigationSplitViewColumnWidth(min: 280, ideal: 330)
                } detail: {
                    detailContent
                }
            } else {
                HSplitView {
                    sidebarContent
                        .frame(minWidth: 280, idealWidth: 330, maxWidth: 360)

                    detailContent
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .navigationTitle("Clip Library")
        .toolbar {
            ToolbarItemGroup {
                Button("Refresh") {
                    model.reloadClips()
                }

                Button("Open Folder") {
                    model.openClipsFolder()
                }
            }
        }
        .onAppear {
            model.reloadClips()
            replacePlayerItem(with: model.selectedClip?.url)
        }
        .onChange(of: model.selectedClip?.url) { newValue in
            replacePlayerItem(with: newValue)
        }
    }

    private var sidebarContent: some View {
        ZStack {
            MacClipperBackdrop()

            VStack(spacing: 14) {
                MacClipperSurface {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Clip Library")
                                    .font(.system(size: 22, weight: .bold, design: .rounded))

                                Text("Your saved moments, ready to scrub, replay, and find fast.")
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }

                            Spacer(minLength: 0)

                            MacClipperPill(title: "\(model.clips.count)", systemImage: "film.stack.fill", tint: MacClipperTheme.cyan)
                        }

                        HStack(spacing: 10) {
                            Button("Refresh") {
                                model.reloadClips()
                            }
                            .buttonStyle(MacClipperSecondaryButtonStyle())

                            Button("Open Folder") {
                                model.openClipsFolder()
                            }
                            .buttonStyle(MacClipperSecondaryButtonStyle())
                        }
                    }
                }

                List(selection: selectedClipURLBinding) {
                    ForEach(model.clips) { clip in
                        ClipSidebarRow(clip: clip, isSelected: model.selectedClip?.url == clip.url)
                            .tag(Optional(clip.url))
                            .listRowInsets(EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8))
                            .listRowBackground(Color.clear)
                    }
                }
                .listStyle(.sidebar)
                .modifier(LegacyLibraryListBackground())
            }
            .padding(16)
        }
    }

    private var detailContent: some View {
        ZStack {
            MacClipperBackdrop()

            Group {
                if let clip = model.selectedClip {
                    VStack(alignment: .leading, spacing: 18) {
                        MacClipperSurface {
                            HStack(alignment: .top, spacing: 16) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(clip.url.deletingPathExtension().lastPathComponent)
                                        .font(.system(size: 28, weight: .bold, design: .rounded))
                                        .lineLimit(2)

                                    Text("Saved \(clip.createdAt.formatted(date: .complete, time: .shortened))")
                                        .font(.system(size: 13, weight: .medium, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }

                                Spacer(minLength: 0)

                                ClipSourceIconView(sourceApp: clip.sourceApp, size: 36)
                            }

                            HStack(spacing: 8) {
                                MacClipperPill(
                                    title: clip.sourceApp?.name ?? "Unknown App",
                                    systemImage: clip.sourceApp == nil ? "questionmark.app.fill" : "app.fill",
                                    tint: MacClipperTheme.cyan
                                )
                                MacClipperPill(title: clip.fileSizeText, systemImage: "internaldrive.fill", tint: MacClipperTheme.sand)
                            }
                        }

                        MacClipperSurface(cornerRadius: 28, padding: 14) {
                            ZStack {
                                VideoPlayer(player: player)
                                    .frame(minHeight: 410)
                                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                    .onAppear { replacePlayerItem(with: clip.url) }

                                if let playerError {
                                    VStack(spacing: 8) {
                                        Image(systemName: "exclamationmark.triangle.fill")
                                            .font(.system(size: 28))
                                            .foregroundStyle(MacClipperTheme.ember)
                                        Text(playerError)
                                            .font(.system(size: 13, weight: .medium))
                                            .foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .background(.ultraThinMaterial)
                                }
                            }
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                Button {
                                    openEditor(for: clip)
                                } label: {
                                    Label("Edit", systemImage: "scissors")
                                }
                                .buttonStyle(MacClipperPrimaryButtonStyle())
                                .popover(isPresented: $showEditorAccessPopover, arrowEdge: .top) {
                                    ClipEditorAccessPopover(clipName: clip.url.deletingPathExtension().lastPathComponent)
                                        .environmentObject(model)
                                }

                                Button {
                                    model.uploadClipToCloud(clip)
                                } label: {
                                    Label("Cloud", systemImage: "cloud.fill")
                                }
                                .buttonStyle(MacClipperSecondaryButtonStyle())

                                Button {
                                    model.presentClipSharePanel(for: clip)
                                } label: {
                                    Label("Share", systemImage: "square.and.arrow.up")
                                }
                                .buttonStyle(MacClipperSecondaryButtonStyle())

                                Button("Play") {
                                    player.play()
                                }
                                .buttonStyle(MacClipperPrimaryButtonStyle())

                                Button("Pause") {
                                    player.pause()
                                }
                                .buttonStyle(MacClipperSecondaryButtonStyle())

                                Button("Copy") {
                                    model.copyClipToClipboard(clip.url)
                                }
                                .buttonStyle(MacClipperSecondaryButtonStyle())

                                Button("Reveal in Finder") {
                                    model.revealClip(at: clip.url)
                                }
                                .buttonStyle(MacClipperSecondaryButtonStyle())

                                Button("Open Externally") {
                                    model.openClip(clip)
                                }
                                .buttonStyle(MacClipperSecondaryButtonStyle())

                                Button("Delete") {
                                    player.pause()
                                    model.deleteClip(clip)
                                }
                                .buttonStyle(MacClipperSecondaryButtonStyle())
                            }
                        }

                        Spacer(minLength: 0)
                    }
                    .padding(20)
                } else {
                    MacClipperSurface {
                        if #available(macOS 14.0, *) {
                            ContentUnavailableView(
                                "No Clips Yet",
                                systemImage: "film.stack",
                                description: Text("Save a replay clip, then open this library to watch it here.")
                            )
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            VStack(spacing: 12) {
                                Image(systemName: "film.stack")
                                    .font(.system(size: 38, weight: .semibold))
                                    .foregroundStyle(MacClipperTheme.cyan)

                                Text("No Clips Yet")
                                    .font(.system(size: 22, weight: .bold, design: .rounded))

                                Text("Save a replay clip, then open this library to watch it here.")
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    .padding(20)
                }
            }
        }
    }

    private var selectedClipURLBinding: Binding<URL?> {
        Binding(
            get: { model.selectedClip?.url },
            set: { newURL in
                model.selectedClip = model.clips.first(where: { $0.url == newURL })
            }
        )
    }

    private func replacePlayerItem(with url: URL?) {
        guard let url else {
            player.replaceCurrentItem(with: nil)
            playerError = nil
            return
        }

        playerError = nil
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            if item.status == .failed {
                playerError = "Could not load this video file."
            }
        }
    }

    private func openEditor(for clip: SavedClip) {
        model.selectedClip = clip

        if model.hasUnlocked4KPro {
            model.openClipEditor(for: clip)
        } else {
            showEditorAccessPopover = true
        }
    }
}

private struct LegacyLibraryListBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 13.0, *) {
            content
                .scrollContentBackground(.hidden)
                .background(Color.clear)
        } else {
            content
                .background(Color.clear)
        }
    }
}

private struct ClipSidebarRow: View {
    let clip: SavedClip
    let isSelected: Bool
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ClipSourceIconView(sourceApp: clip.sourceApp, size: 28)

            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .center, spacing: 6) {
                    Text(clip.url.deletingPathExtension().lastPathComponent)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .lineLimit(2)
                }

                let appName = clip.sourceApp?.name ?? "App not detected"
                Text(appName)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Text(clip.createdAt.formatted(date: .abbreviated, time: .shortened))
                    Text("•")
                    Text(clip.fileSizeText)
                }
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(isSelected ? MacClipperTheme.cyan.opacity(0.18) : Color.white.opacity(0.04))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(isSelected ? MacClipperTheme.cyan.opacity(0.45) : Color.white.opacity(0.06), lineWidth: 1)
        )
    }
}

private struct ClipSourceIconView: View {
    let sourceApp: ClipSourceApp?
    let size: CGFloat

    var body: some View {
        if let icon = ClipAppIconProvider.icon(for: sourceApp, size: size) {
            Image(nsImage: icon)
                .resizable()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.22))
        } else {
            Image(systemName: "gamecontroller.fill")
                .font(.system(size: max(12, size * 0.72)))
                .foregroundStyle(.secondary)
                .frame(width: size, height: size)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: size * 0.22))
        }
    }
}

private enum ClipAppIconProvider {
    static func icon(for sourceApp: ClipSourceApp?, size: CGFloat) -> NSImage? {
        guard let sourceApp,
              let bundleIdentifier = sourceApp.bundleIdentifier,
              let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            return nil
        }

        let icon = NSWorkspace.shared.icon(forFile: appURL.path)
        icon.size = NSSize(width: size, height: size)
        return icon
    }
}
