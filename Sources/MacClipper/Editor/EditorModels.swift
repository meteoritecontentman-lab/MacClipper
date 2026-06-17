import SwiftUI
import AVKit

/// Timeline track for video, audio, images, overlays, and keyframes
struct EditorTimelineTrack: Identifiable {
    enum TrackType { case video, audio, image, overlay, effect }
    let id = UUID()
    let type: TrackType
    let name: String
    var items: [EditorTimelineItem]
}

/// Timeline item (clip, image, effect, etc.)
struct EditorTimelineItem: Identifiable {
    let id = UUID()
    var name: String
    var startTime: Double
    var duration: Double
    let type: EditorMediaType
    let content: EditorTimelineContent
    var position: CGPoint = .zero
    var scale: CGFloat = 1.0
    var rotation: Angle = .zero
    var opacity: Double = 1.0
    var keyframes: [EditorKeyframe] = []
}

enum EditorTimelineContent {
    case video(url: URL)
    case audio(url: URL)
    case image(url: URL)
    case overlay(text: String)
    case effect(name: String)
}

/// Keyframe for animatable properties
struct EditorKeyframe: Identifiable {
    let id = UUID()
    let itemId: UUID
    let time: Double
    let property: String
    var value: Double
}

/// Media item for the media library
struct EditorMediaItem: Identifiable {
    let id = UUID()
    let filename: String
    let url: URL
    let type: EditorMediaType
    let thumbnail: NSImage?
}

enum EditorMediaType {
    case video, audio, image
}
