import SwiftUI
import AVKit

struct CommunityClipsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var clips: [(clip: CommunityClip, profile: CommunityProfile?)] = []
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedClip: CommunityClip?
    @State private var selectedProfile: CommunityProfile?

    private let columns = [
        GridItem(.adaptive(minimum: 200, maximum: 220), spacing: 8)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                header
                searchBar
                if isLoading {
                    loadingState
                } else if let errorMessage {
                    errorState(message: errorMessage)
                } else if clips.isEmpty {
                    emptyState
                } else {
                    clipGrid
                }
            }
            .padding(12)
        }
        .sheet(item: $selectedClip) { clip in
            ClipPlayerView(clip: clip, profile: selectedProfile)
        }
        .task {
            await loadClips()
        }
        .onChange(of: searchText) { _ in
            Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                await loadClips()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Community")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(SlateTheme.textPrimary)
            Text("Discover clips shared by the MacClipper community")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(SlateTheme.textSecondary)
        }
    }

    private var searchBar: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(SlateTheme.textTertiary)
            TextField("Search clips...", text: $searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 11, weight: .medium))
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

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
                .scaleEffect(0.7)
                .tint(SlateTheme.accent)
            Text("Loading community clips...")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(SlateTheme.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private func errorState(message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(SlateTheme.warning)
            Text("Couldn't load clips")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(SlateTheme.textPrimary)
            Text(message)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(SlateTheme.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                Task { await loadClips() }
            } label: {
                SlateCapsuleButtonLabel(title: "Retry", systemImage: "arrow.clockwise", density: .compact)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "film.stack")
                .font(.system(size: 28))
                .foregroundStyle(SlateTheme.textTertiary)
            Text("No clips found")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(SlateTheme.textPrimary)
            Text(searchText.isEmpty ? "Be the first to share a clip!" : "Try a different search term")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(SlateTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private var clipGrid: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(clips, id: \.clip.id) { item in
                clipCard(item.clip, profile: item.profile)
            }
        }
    }

    private func clipCard(_ clip: CommunityClip, profile: CommunityProfile?) -> some View {
        Button {
            selectedClip = clip
            selectedProfile = profile
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                thumbnailView(for: clip)
                cardInfo(clip, profile: profile)
            }
            .background(SlateTheme.panel)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(SlateTheme.panelBorder, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func thumbnailView(for clip: CommunityClip) -> some View {
        Group {
            if let thumbnailURL = clip.thumbnail_url, let url = URL(string: thumbnailURL) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(16/9, contentMode: .fill)
                    case .failure, .empty:
                        if let videoURL = clip.content.flatMap({ URL(string: $0) }) {
                            VideoThumbnailView(videoURL: videoURL)
                        } else {
                            thumbnailPlaceholder
                        }
                    @unknown default:
                        thumbnailPlaceholder
                    }
                }
            } else if let videoURL = clip.content.flatMap({ URL(string: $0) }) {
                VideoThumbnailView(videoURL: videoURL)
            } else {
                thumbnailPlaceholder
            }
        }
        .frame(height: 110)
        .clipped()
    }

    private var thumbnailPlaceholder: some View {
        ZStack {
            SlateTheme.row
            Image(systemName: "film.stack")
                .font(.system(size: 24))
                .foregroundStyle(SlateTheme.textTertiary)
        }
        .frame(height: 110)
    }

    private func cardInfo(_ clip: CommunityClip, profile: CommunityProfile?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(clip.title ?? "Untitled Clip")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(SlateTheme.textPrimary)
                .lineLimit(2)

            HStack(spacing: 4) {
                if let avatarURL = profile?.avatar_url, let url = URL(string: avatarURL) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image
                                .resizable()
                                .frame(width: 14, height: 14)
                                .clipShape(Circle())
                        } else {
                            defaultPFP
                        }
                    }
                } else {
                    defaultPFP
                }
                Text(profile?.display_name ?? displayNameFallback(for: clip))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(SlateTheme.textSecondary)
                    .lineLimit(1)
            }

            if let game = clip.game_title, !game.isEmpty {
                HStack(spacing: 3) {
                    Image(systemName: "gamecontroller.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(SlateTheme.warning)
                    Text(game)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(SlateTheme.textTertiary)
                        .lineLimit(1)
                }
            }

            if let category = clip.category_label, !category.isEmpty {
                HStack(spacing: 3) {
                    Image(systemName: "tag.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(SlateTheme.success)
                    Text(category)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(SlateTheme.textTertiary)
                        .lineLimit(1)
                }
            }
        }
        .padding(8)
    }

    private var defaultPFP: some View {
        Image(systemName: "person.crop.circle.fill")
            .font(.system(size: 14))
            .foregroundStyle(SlateTheme.accent)
    }

    private func displayNameFallback(for clip: CommunityClip) -> String {
        if let uid = clip.user_id {
            return String(uid.prefix(8)) + "..."
        }
        return "Unknown"
    }

    private func loadClips() async {
        isLoading = true
        errorMessage = nil
        do {
            clips = try await CommunityClipsClient.shared.fetchClipsWithProfiles(search: searchText.isEmpty ? nil : searchText)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct VideoThumbnailView: View {
    let videoURL: URL
    @State private var thumbnail: NSImage?

    var body: some View {
        ZStack {
            SlateTheme.row
            if let thumbnail {
                Image(nsImage: thumbnail)
                    .resizable()
                    .aspectRatio(16/9, contentMode: .fill)
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "play.rectangle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(SlateTheme.textTertiary)
                    ProgressView()
                        .scaleEffect(0.5)
                        .tint(SlateTheme.accent)
                }
            }
        }
        .frame(height: 110)
        .task {
            await generateThumbnail()
        }
    }

    private func generateThumbnail() async {
        let asset = AVAsset(url: videoURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 440, height: 248)

        let time = CMTime(seconds: 1, preferredTimescale: 60)
        let cgImage = try? await Task.detached {
            try generator.copyCGImage(at: time, actualTime: nil)
        }.value
        if let cgImage {
            thumbnail = NSImage(cgImage: cgImage, size: NSSize(width: 220, height: 124))
        }
    }
}

private struct ClipPlayerView: View {
    let clip: CommunityClip
    let profile: CommunityProfile?
    @Environment(\.dismiss) private var dismiss
    @State private var comments: [ClipComment] = []
    @State private var commentText = ""
    @State private var isSending = false
    @State private var commenterName = Host.current().localizedName ?? "Mac User"

    var body: some View {
        VStack(spacing: 0) {
            header
            if let urlString = clip.content, let url = URL(string: urlString) {
                VideoPlayerView(url: url)
                    .frame(minHeight: 280)
            } else {
                Text("Video unavailable")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
            commentSection
        }
        .frame(width: 520, height: 520)
        .task {
            await reloadComments()
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(clip.title ?? "Untitled Clip")
                    .font(.system(size: 14, weight: .bold))
                HStack(spacing: 6) {
                    Text(profile?.display_name ?? displayOwnerName(clip: clip))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                    if let game = clip.game_title, !game.isEmpty {
                        Text(game)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
    }

    private var commentSection: some View {
        VStack(spacing: 0) {
            Divider()
            ScrollView {
                if comments.isEmpty {
                    Text("No comments yet")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 16)
                } else {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(comments) { comment in
                            commentRow(comment)
                        }
                    }
                    .padding(8)
                }
            }
            .frame(maxHeight: 100)

            Divider()
            HStack(spacing: 6) {
                TextField("Add a comment...", text: $commentText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 11))
                    .padding(6)
                    .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
                Button {
                    sendComment()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(commentText.trimmingCharacters(in: .whitespaces).isEmpty ? Color.secondary : Color.accentColor)
                }
                .buttonStyle(.plain)
                .disabled(commentText.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
            }
            .padding(8)
        }
    }

    private func commentRow(_ comment: ClipComment) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(.tertiary)
            VStack(alignment: .leading, spacing: 1) {
                Text(comment.commenter_name ?? String(comment.user_id.prefix(8)) + "...")
                    .font(.system(size: 10, weight: .semibold))
                Text(comment.body)
                    .font(.system(size: 11))
                    .foregroundStyle(.primary)
            }
        }
        .padding(4)
    }

    private func displayOwnerName(clip: CommunityClip) -> String {
        if let uid = clip.user_id {
            return String(uid.prefix(8)) + "..."
        }
        return "Unknown"
    }

    private func reloadComments() async {
        comments = (try? await CommunityClipsClient.shared.fetchComments(clipID: clip.id)) ?? []
    }

    private func sendComment() {
        let text = commentText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        isSending = true
        Task {
            let deviceID = await MainActor.run { Self.deviceCommenterID() }
            try? await CommunityClipsClient.shared.insertComment(
                clipID: clip.id,
                userID: deviceID,
                commenterName: commenterName,
                body: text
            )
            commentText = ""
            isSending = false
            await reloadComments()
        }
    }

    private static func deviceCommenterID() -> String {
        let defaults = UserDefaults.standard
        if let stored = defaults.string(forKey: "communityCommenterID") {
            return stored
        }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: "communityCommenterID")
        return id
    }
}

private struct VideoPlayerView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> AVPlayerView {
        let player = AVPlayer(url: url)
        let view = AVPlayerView()
        view.player = player
        view.controlsStyle = .floating
        view.autoresizingMask = [.width, .height]
        player.play()
        return view
    }

    func updateNSView(_ nsView: AVPlayerView, context: Context) {}
}
