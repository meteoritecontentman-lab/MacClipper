import AppKit
import AVFoundation
import QuartzCore

@MainActor
internal enum MiniCutTimelineExporter {
    private struct VideoEntry {
        let timelineIndex: Int
        let clip: OffsetClip
        let compositionTrack: AVMutableCompositionTrack
        let sourceTrack: AVAssetTrack
        let insertTime: CMTime
        let duration: CMTime
    }

    private struct TextEntry {
        let timelineIndex: Int
        let clip: OffsetClip
        let text: ClipContent.ClipText
    }

    private struct ColorEntry {
        let timelineIndex: Int
        let clip: OffsetClip
        let color: ClipContent.ClipColor
    }

    static func export(
        state: MiniCutState,
        clipName: String,
        outputURL: URL,
        options: MiniCutExportOptions
    ) async throws -> URL {
        let composition = AVMutableComposition()
        let renderSize = options.orientation.renderSize
        let totalDurationSeconds = max(state.timeline.maxOffset, 0.1)
        let totalDuration = CMTime(seconds: totalDurationSeconds, preferredTimescale: 600)

        var videoEntries: [VideoEntry] = []
        var audioParameters: [AVMutableAudioMixInputParameters] = []
        var textEntries: [TextEntry] = []
        var colorEntries: [ColorEntry] = []

        for (timelineIndex, track) in state.timeline.tracks.enumerated() {
            for offsetClip in track.clips.sorted(by: { $0.offset < $1.offset }) {
                let insertTime = CMTime(seconds: offsetClip.offset, preferredTimescale: 600)
                let clipDuration = CMTime(seconds: offsetClip.clip.length, preferredTimescale: 600)

                guard clipDuration > .zero else { continue }

                switch offsetClip.clip.content {
                case .audiovisual(let audiovisual):
                    let sourceAsset = audiovisual.asset
                    let videoTracks = try await sourceAsset.loadTracks(withMediaType: .video)
                    let audioTracks = try await sourceAsset.loadTracks(withMediaType: .audio)
                    let startTime = CMTime(seconds: offsetClip.clip.start, preferredTimescale: 600)
                    let timeRange = CMTimeRange(start: startTime, duration: clipDuration)

                    if let sourceVideoTrack = videoTracks.first,
                       let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) {
                        try compositionVideoTrack.insertTimeRange(timeRange, of: sourceVideoTrack, at: insertTime)
                        videoEntries.append(
                            VideoEntry(
                                timelineIndex: timelineIndex,
                                clip: offsetClip,
                                compositionTrack: compositionVideoTrack,
                                sourceTrack: sourceVideoTrack,
                                insertTime: insertTime,
                                duration: clipDuration
                            )
                        )
                    }

                    for sourceAudioTrack in audioTracks {
                        guard let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                            continue
                        }

                        try compositionAudioTrack.insertTimeRange(timeRange, of: sourceAudioTrack, at: insertTime)

                        let params = AVMutableAudioMixInputParameters(track: compositionAudioTrack)
                        params.setVolume(Float(offsetClip.clip.volume), at: insertTime)
                        audioParameters.append(params)
                    }
                case .text(let text):
                    textEntries.append(TextEntry(timelineIndex: timelineIndex, clip: offsetClip, text: text))
                case .color(let color):
                    colorEntries.append(ColorEntry(timelineIndex: timelineIndex, clip: offsetClip, color: color))
                case .image:
                    continue
                }
            }
        }

        guard !videoEntries.isEmpty else {
            throw ExportError.noVisualMedia
        }

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 60)

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: totalDuration)
        instruction.layerInstructions = videoEntries
            .sorted { lhs, rhs in
                if lhs.timelineIndex == rhs.timelineIndex {
                    return lhs.insertTime < rhs.insertTime
                }
                return lhs.timelineIndex < rhs.timelineIndex
            }
            .map { entry in
                let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: entry.compositionTrack)
                let transform = makeTransform(
                    for: entry.clip.clip,
                    sourceTrack: entry.sourceTrack,
                    renderSize: renderSize,
                    orientation: options.orientation
                )
                layerInstruction.setTransform(transform, at: entry.insertTime)
                layerInstruction.setOpacity(Float(entry.clip.clip.visualAlpha), at: entry.insertTime)
                layerInstruction.setOpacity(0, at: CMTimeAdd(entry.insertTime, entry.duration))
                return layerInstruction
            }
        videoComposition.instructions = [instruction]

        let parentLayer = CALayer()
        parentLayer.frame = CGRect(origin: .zero, size: renderSize)

        let videoLayer = CALayer()
        videoLayer.frame = parentLayer.frame

        for colorEntry in colorEntries.sorted(by: { $0.timelineIndex > $1.timelineIndex }) {
            let layer = CALayer()
            layer.frame = parentLayer.frame
            layer.backgroundColor = colorEntry.color.color.cgColor
            applyVisibility(to: layer, clip: colorEntry.clip.clip, offset: colorEntry.clip.offset, totalDuration: totalDurationSeconds)
            parentLayer.addSublayer(layer)
        }

        parentLayer.addSublayer(videoLayer)

        for textEntry in textEntries.sorted(by: { $0.timelineIndex > $1.timelineIndex }) {
            let fontScale = max(renderSize.height / 240.0, 1)
            let fontSize = CGFloat(textEntry.text.size) * fontScale * CGFloat(textEntry.clip.clip.visualScale)
            let width = renderSize.width * 0.82
            let height = max(fontSize * 1.7, 52)
            let offsetX = CGFloat(textEntry.clip.clip.visualOffsetDx) * renderSize.width
            let offsetY = CGFloat(textEntry.clip.clip.visualOffsetDy) * renderSize.height

            let textLayer = CATextLayer()
            textLayer.alignmentMode = .center
            textLayer.isWrapped = true
            textLayer.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
            textLayer.foregroundColor = textEntry.text.color.cgColor
            textLayer.string = NSAttributedString(
                string: textEntry.text.text,
                attributes: [
                    .font: NSFont.systemFont(ofSize: fontSize, weight: .bold),
                    .foregroundColor: textEntry.text.color
                ]
            )
            textLayer.frame = CGRect(
                x: (renderSize.width - width) / 2 + offsetX,
                y: (renderSize.height - height) / 2 + offsetY,
                width: width,
                height: height
            )
            applyVisibility(to: textLayer, clip: textEntry.clip.clip, offset: textEntry.clip.offset, totalDuration: totalDurationSeconds)
            parentLayer.addSublayer(textLayer)
        }

        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
            postProcessingAsVideoLayer: videoLayer,
            in: parentLayer
        )

        let audioMix = audioParameters.isEmpty ? nil : AVMutableAudioMix()
        audioMix?.inputParameters = audioParameters

        try? FileManager.default.removeItem(at: outputURL)

        var lastError: Error?
        for preset in options.codec.presetCandidates {
            guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) else {
                continue
            }

            guard let fileType = options.codec.preferredFileTypes.first(where: exporter.supportedFileTypes.contains) else {
                continue
            }

            exporter.outputURL = outputURL
            exporter.outputFileType = fileType
            exporter.videoComposition = videoComposition
            exporter.audioMix = audioMix
            exporter.shouldOptimizeForNetworkUse = true
            exporter.timeRange = CMTimeRange(start: .zero, duration: totalDuration)

            do {
                try await exporter.export(to: outputURL, as: fileType)
                return outputURL
            } catch {
                lastError = error
                try? FileManager.default.removeItem(at: outputURL)
            }
        }

        throw lastError ?? ExportError.failed("Unable to export \(clipName).")
    }

    private static func applyVisibility(to layer: CALayer, clip: Clip, offset: TimeInterval, totalDuration: TimeInterval) {
        let start = max(0, min(totalDuration, offset))
        let end = max(start, min(totalDuration, offset + clip.length))
        let opacity = Float(clip.visualAlpha)

        layer.opacity = 0

        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = [0, 0, opacity, opacity, 0]
        animation.keyTimes = [
            0,
            NSNumber(value: start / totalDuration),
            NSNumber(value: start / totalDuration),
            NSNumber(value: end / totalDuration),
            1
        ]
        animation.duration = totalDuration
        animation.isRemovedOnCompletion = false
        animation.fillMode = .forwards
        layer.add(animation, forKey: "opacity")
    }

    private static func makeTransform(
        for clip: Clip,
        sourceTrack: AVAssetTrack,
        renderSize: CGSize,
        orientation: MiniCutExportOrientation
    ) -> CGAffineTransform {
        let preferredTransform = sourceTrack.preferredTransform
        let sourceRect = CGRect(origin: .zero, size: sourceTrack.naturalSize).applying(preferredTransform)
        let orientedSize = CGSize(width: abs(sourceRect.width), height: abs(sourceRect.height))

        let normalize = CGAffineTransform(translationX: -sourceRect.origin.x, y: -sourceRect.origin.y)
        let widthScale = renderSize.width / max(orientedSize.width, 1)
        let heightScale = renderSize.height / max(orientedSize.height, 1)
        let baseScale = orientation == .vertical ? max(widthScale, heightScale) : min(widthScale, heightScale)
        let scale = baseScale * CGFloat(clip.visualScale)
        let scaledSize = CGSize(width: orientedSize.width * scale, height: orientedSize.height * scale)

        let offsetX = ((renderSize.width - scaledSize.width) / 2) + (CGFloat(clip.visualOffsetDx) * renderSize.width)
        let offsetY = ((renderSize.height - scaledSize.height) / 2) + (CGFloat(clip.visualOffsetDy) * renderSize.height)

        return preferredTransform
            .concatenating(normalize)
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: offsetX, y: offsetY))
    }

    private enum ExportError: LocalizedError {
        case noVisualMedia
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .noVisualMedia:
                return "There is no video on the timeline to export yet."
            case .failed(let message):
                return message
            }
        }
    }
}