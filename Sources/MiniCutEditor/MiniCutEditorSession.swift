import AppKit
import AVFoundation
import Combine
import SpriteKit
import SwiftUI
import UniformTypeIdentifiers

public enum MiniCutExportOrientation: String, CaseIterable, Identifiable, Sendable {
    case horizontal
    case vertical

    public var id: Self { self }

    public var title: String {
        switch self {
        case .horizontal:
            return "Horizontal"
        case .vertical:
            return "Vertical"
        }
    }

    var renderSize: CGSize {
        switch self {
        case .horizontal:
            return CGSize(width: 1920, height: 1080)
        case .vertical:
            return CGSize(width: 1080, height: 1920)
        }
    }
}

public enum MiniCutExportCodec: String, CaseIterable, Identifiable, Sendable {
    case h264
    case hevc

    public var id: Self { self }

    public var title: String {
        switch self {
        case .h264:
            return "H.264"
        case .hevc:
            return "HEVC"
        }
    }

    var presetCandidates: [String] {
        switch self {
        case .h264:
            return [AVAssetExportPresetHighestQuality, AVAssetExportPreset1920x1080]
        case .hevc:
            return [AVAssetExportPresetHEVCHighestQuality, AVAssetExportPresetHighestQuality]
        }
    }

    var preferredFileTypes: [AVFileType] {
        switch self {
        case .h264:
            return [.mp4, .mov]
        case .hevc:
            return [.mov]
        }
    }

    public var preferredFilenameExtension: String {
        switch self {
        case .h264:
            return "mp4"
        case .hevc:
            return "mov"
        }
    }

    public var allowedContentTypes: [UTType] {
        switch self {
        case .h264:
            return [.mpeg4Movie, .movie]
        case .hevc:
            return [.movie]
        }
    }
}

public struct MiniCutExportOptions: Sendable {
    public var orientation: MiniCutExportOrientation
    public var codec: MiniCutExportCodec

    public init(
        orientation: MiniCutExportOrientation = .horizontal,
        codec: MiniCutExportCodec = .h264
    ) {
        self.orientation = orientation
        self.codec = codec
    }
}

@MainActor
public final class MiniCutEditorSession: ObservableObject {
    @Published public private(set) var clipURL: URL
    @Published public private(set) var clipName: String
    @Published public private(set) var statusText: String = "Ready to edit"

    private let state: MiniCutState
    private weak var attachedView: SKView?
    private var scene: MiniCutScene?

    public init(clipURL: URL) {
        self.clipURL = clipURL
        self.clipName = clipURL.deletingPathExtension().lastPathComponent
        self.state = MiniCutState()
        loadClip(clipURL)
    }

    public var suggestedExportFilename: String {
        "\(clipName).edited"
    }

    public func loadClip(_ url: URL) {
        clipURL = url
        clipName = url.deletingPathExtension().lastPathComponent

        let clip = Clip(url: url)
        let mainTrack = makePrimaryTrack(for: clip)

        state.isPlaying = false
        state.cursor = 0
        state.timelineOffset = 0
        state.library = Library(clips: [clip])
        state.timeline = Timeline(tracks: [mainTrack])
        state.selection = mainTrack.clips.sorted(by: { $0.offset < $1.offset }).first.map {
            Selection(trackId: mainTrack.id, clipId: $0.id)
        }
        statusText = "Loaded \(clipName) into the editor"
    }

    public func attach(to view: SKView) {
        guard attachedView !== view || scene == nil || scene?.size != view.bounds.size else { return }

        attachedView = view
        let targetSize = view.bounds.size == .zero ? CGSize(width: 1200, height: 720) : view.bounds.size
        let scene = MiniCutScene(size: targetSize, state: state, title: "MacClipper")
        scene.scaleMode = .aspectFill

        view.presentScene(scene)
        view.ignoresSiblingOrder = true
        view.showsFPS = false
        view.showsNodeCount = false

        self.scene = scene
    }

    public func export(to outputURL: URL, options: MiniCutExportOptions) async throws -> URL {
        statusText = "Exporting \(clipName)..."

        do {
            let result = try await MiniCutTimelineExporter.export(
                state: state,
                clipName: clipName,
                outputURL: outputURL,
                options: options
            )
            statusText = "Exported \(result.lastPathComponent)"
            return result
        } catch {
            statusText = "Export failed: \(error.localizedDescription)"
            throw error
        }
    }

    private func makePrimaryTrack(for clip: Clip) -> Track {
        var track = Track(name: "Track 1")
        track.insert(clip: OffsetClip(clip: clip, offset: 0))
        return track
    }
}

public struct MiniCutEditorCanvas: NSViewRepresentable {
    @ObservedObject private var session: MiniCutEditorSession

    public init(session: MiniCutEditorSession) {
        self.session = session
    }

    public func makeNSView(context: Context) -> SKView {
        let view = SKView(frame: .zero)
        view.preferredFramesPerSecond = 60
        session.attach(to: view)
        return view
    }

    public func updateNSView(_ nsView: SKView, context: Context) {
        session.attach(to: nsView)
    }
}