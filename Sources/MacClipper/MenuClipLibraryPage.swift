import SwiftUI
import AVKit
import AppKit

struct MenuClipLibraryPage: View {
    @EnvironmentObject private var model: AppModel

    let onBack: () -> Void

    @State private var player = AVPlayer()
    @State private var showEditorAccessPopover = false
    @State private var cloudProgress: Double = 0
    @State private var searchText = ""
    @State private var playerError: String?

    private let density: SlateDensity = .compact

    private var filteredClips: [SavedClip] {
        if searchText.isEmpty {
            return model.clips
        }
        return model.clips.filter { clip in
            let name = clip.url.deletingPathExtension().lastPathComponent.lowercased()
            let app = (clip.sourceApp?.name ?? "").lowercased()
            let query = searchText.lowercased()
            return name.contains(query) || app.contains(query)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    selectedClipPanel

                    searchBar

                    SlatePanelDivider()
                    SlateSectionCaption(title: "Saved Clips", density: density)

                    if model.clips.isEmpty {
                        emptyLibraryState
                    } else if filteredClips.isEmpty {
                        noSearchResultsState
                    } else {
                        clipList
                    }
                }
                .padding(.trailing, 4)
            }
            .frame(height: 430)
        }
        .frame(width: 560)
        .onAppear {
            model.reloadClips()
            replacePlayerItem(with: model.selectedClip?.url)
        }
        .onChange(of: model.selectedClip?.url) { newValue in
            replacePlayerItem(with: newValue)
        }
        .onChange(of: model.cloudShareStatus) { newValue in
            syncCloudProgress(with: newValue)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button {
                onBack()
            } label: {
                SlateToolbarButtonLabel(systemImage: "chevron.left", density: density)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text("Clip Library")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(SlateTheme.textPrimary)

                Text(model.clipCountText)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
            }

            Spacer(minLength: 0)

            Button {
                model.reloadClips()
            } label: {
                SlateToolbarButtonLabel(systemImage: "arrow.clockwise", density: density)
            }
            .buttonStyle(.plain)

            Button {
                model.openClipsFolder()
            } label: {
                SlateToolbarButtonLabel(systemImage: "folder.fill", density: density)
            }
            .buttonStyle(.plain)
        }
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(SlateTheme.textTertiary)
            TextField("Search clips by name or app...", text: $searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(SlateTheme.textPrimary)
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(SlateTheme.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .background(SlateTheme.control)
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(SlateTheme.controlBorder, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    @ViewBuilder
    private var selectedClipPanel: some View {
        if let clip = model.selectedClip {
            SlateInsetPanel {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 10) {
                        MenuClipSourceIconView(sourceApp: clip.sourceApp, size: 30)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(clip.url.deletingPathExtension().lastPathComponent)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(SlateTheme.textPrimary)
                                .lineLimit(2)

                            Text(clipSubtitle(for: clip))
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(SlateTheme.textSecondary)
                                .lineLimit(2)
                        }

                        Spacer(minLength: 0)

                        let badgeText = clip.fileSizeText
                        SlateStatusBadge(title: badgeText, tint: SlateTheme.warning)
                    }

                    ZStack {
                        VideoPlayer(player: player)
                            .frame(height: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                        if let playerError {
                            VStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 22))
                                    .foregroundStyle(SlateTheme.warning)
                                Text(playerError)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(SlateTheme.textSecondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(.ultraThinMaterial)
                        }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            Button {
                                openEditor(for: clip)
                            } label: {
                                SlateCapsuleButtonLabel(title: "Edit", systemImage: "scissors", tint: SlateTheme.textPrimary, highlighted: true, density: density)
                            }
                            .buttonStyle(.plain)
                            .popover(isPresented: $showEditorAccessPopover, arrowEdge: .top) {
                                ClipEditorAccessPopover(clipName: clip.url.deletingPathExtension().lastPathComponent)
                                    .environmentObject(model)
                            }

                            Button {
                                model.uploadClipToCloud(clip)
                            } label: {
                                SlateCapsuleButtonLabel(title: "Cloud", systemImage: "cloud.fill", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                model.presentClipSharePanel(for: clip)
                            } label: {
                                SlateCapsuleButtonLabel(title: "Share", systemImage: "square.and.arrow.up", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                player.play()
                            } label: {
                                SlateCapsuleButtonLabel(title: "Play", systemImage: "play.fill", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                player.pause()
                            } label: {
                                SlateCapsuleButtonLabel(title: "Pause", systemImage: "pause.fill", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                model.copyClipToClipboard(clip.url)
                            } label: {
                                SlateCapsuleButtonLabel(title: "Copy", systemImage: "doc.on.doc", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                model.revealClip(at: clip.url)
                            } label: {
                                SlateCapsuleButtonLabel(title: "Reveal", systemImage: "folder", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                model.openClip(clip)
                            } label: {
                                SlateCapsuleButtonLabel(title: "Open", systemImage: "arrow.up.right.square", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                player.pause()
                                model.deleteClip(clip)
                            } label: {
                                SlateCapsuleButtonLabel(title: "Delete", systemImage: "trash", tint: SlateTheme.warning, density: density)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if let cloudStatus = model.cloudShareStatus, cloudStatus.clipPath == clip.url.path {
                        cloudStatusView(for: cloudStatus)
                    }
                }
            }
        } else {
            SlateInsetPanel {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Pick a Clip")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(SlateTheme.textPrimary)

                    Text("Choose a saved clip below to preview it here without opening another page.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var clipList: some View {
        VStack(spacing: 4) {
            ForEach(filteredClips) { clip in
                Button {
                    model.selectedClip = clip
                } label: {
                    clipRowView(clip)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func clipRowView(_ clip: SavedClip) -> some View {
        HStack(spacing: 10) {
            ClipThumbnailView(url: clip.url, size: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text(clip.url.deletingPathExtension().lastPathComponent)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(SlateTheme.textPrimary)
                    .lineLimit(1)

                Text(clipSubtitle(for: clip))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Text(clip.fileSizeText)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(SlateTheme.textTertiary)

            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(SlateTheme.textTertiary)
                .padding(.leading, 4)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(model.selectedClip?.url == clip.url ? SlateTheme.accentSoft : SlateTheme.row)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(model.selectedClip?.url == clip.url ? SlateTheme.accent.opacity(0.3) : SlateTheme.rowBorder, lineWidth: 1)
        )
    }

    private var emptyLibraryState: some View {
        SlateInsetPanel {
            VStack(spacing: 10) {
                Image(systemName: "film.stack")
                    .font(.system(size: 28))
                    .foregroundStyle(SlateTheme.textTertiary)

                Text("No Clips Yet")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(SlateTheme.textPrimary)

                Text("Save a replay clip and it will show up here inside the popup.")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        }
    }

    private var noSearchResultsState: some View {
        SlateInsetPanel {
            VStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 22))
                    .foregroundStyle(SlateTheme.textTertiary)

                Text("No clips match \"\(searchText)\"")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(SlateTheme.textPrimary)

                Text("Try a different search term")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        }
    }

    private func clipSubtitle(for clip: SavedClip) -> String {
        let sourceName = clip.sourceApp?.name ?? "Unknown App"
        let timestamp = clip.createdAt.formatted(date: .abbreviated, time: .shortened)
        return "\(sourceName) • \(timestamp)"
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

    @ViewBuilder
    private func cloudStatusView(for status: CloudShareStatusSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            switch status.state {
            case .processing:
                VStack(alignment: .leading, spacing: 6) {
                    Text("Clouding clip inside MacClipper...")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(SlateTheme.textPrimary)

                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 999, style: .continuous)
                                .fill(SlateTheme.control)

                            RoundedRectangle(cornerRadius: 999, style: .continuous)
                                .fill(SlateTheme.accent)
                                .frame(width: max(10, geometry.size.width * cloudProgress))
                        }
                    }
                    .frame(height: 8)

                    Text("Processing takes 3 seconds, then MacClipper waits for the cloud response.")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                }
            case .finishing:
                Text("Finishing cloud upload...")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(SlateTheme.textSecondary)
            case .uploaded(let sharedURL):
                HStack(spacing: 8) {
                    Link(destination: sharedURL) {
                        Label("Clip clouded", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(SlateTheme.success)
                    }

                    Button {
                        model.openCloudDashboard()
                    } label: {
                        Text("Dashboard")
                    }
                    .buttonStyle(.plain)

                    Button {
                        if let clip = clipForPath(status.clipPath) {
                            model.clearCloudShareStatus(for: clip)
                        }
                    } label: {
                        Text("Dismiss")
                    }
                    .buttonStyle(.plain)
                }
                .font(.system(size: 11, weight: .medium))
            case .failed(let message):
                HStack(spacing: 8) {
                    Text(message)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(SlateTheme.warning)
                        .lineLimit(2)

                    Spacer(minLength: 0)

                    Button {
                        if let clip = clipForPath(status.clipPath) {
                            model.uploadClipToCloud(clip)
                        }
                    } label: {
                        Text("Retry")
                    }
                    .buttonStyle(.plain)
                }
            case .needsWebsiteLink:
                HStack(spacing: 8) {
                    Text("Link the website account first. MacClipper opened the link page for you.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                        .lineLimit(2)

                    Spacer(minLength: 0)

                    Button {
                        model.openCloudConnectURL()
                    } label: {
                        Text("Open Website")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 2)
    }

    private func syncCloudProgress(with status: CloudShareStatusSummary?) {
        guard let status else {
            cloudProgress = 0
            return
        }

        switch status.state {
        case .processing:
            cloudProgress = 0
            withAnimation(.linear(duration: 3)) {
                cloudProgress = 1
            }
        default:
            cloudProgress = 1
        }
    }

    private func clipForPath(_ clipPath: String) -> SavedClip? {
        model.clips.first(where: { $0.url.path == clipPath }) ?? model.selectedClip
    }
}

private struct ClipThumbnailView: View {
    let url: URL
    let size: CGFloat

    @State private var thumbnail: NSImage?

    var body: some View {
        Group {
            if let thumbnail {
                Image(nsImage: thumbnail)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                ZStack {
                    SlateTheme.control
                    Image(systemName: "film.stack")
                        .font(.system(size: size * 0.35, weight: .semibold))
                        .foregroundStyle(SlateTheme.textTertiary)
                }
            }
        }
        .frame(width: size, height: size * 0.7)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(SlateTheme.controlBorder, lineWidth: 1)
        )
        .task {
            await generateThumbnail()
        }
    }

    private func generateThumbnail() async {
        let asset = AVAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: size * 2, height: size * 2 * 0.7)

        let time = CMTime(seconds: 1, preferredTimescale: 60)
        let cgImage = try? await Task.detached {
            try generator.copyCGImage(at: time, actualTime: nil)
        }.value
        if let cgImage {
            thumbnail = NSImage(cgImage: cgImage, size: NSSize(width: size, height: size * 0.7))
        }
    }
}

private struct MenuClipSourceIconView: View {
    let sourceApp: ClipSourceApp?
    let size: CGFloat

    var body: some View {
        if let icon = MenuClipAppIconProvider.icon(for: sourceApp, size: size) {
            Image(nsImage: icon)
                .resizable()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.22))
        } else {
            Image(systemName: "film.fill")
                .font(.system(size: max(10, size * 0.58), weight: .semibold))
                .foregroundStyle(SlateTheme.textSecondary)
                .frame(width: size, height: size)
                .background(
                    RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                )
        }
    }
}

private enum MenuClipAppIconProvider {
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
