import AVFoundation
import Foundation

enum ClipSoundEffect {
    case clipStarted
    case clipSaved
}

@MainActor
final class ClipSoundEffectPlayer {
    static let shared = ClipSoundEffectPlayer()

    private struct ToneStep {
        let frequency: Double
        let duration: Double
        let amplitude: Float
        let pauseAfter: Double
    }

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)

    private lazy var clipStartedBuffer = makeBuffer(
        tones: [
            ToneStep(frequency: 760, duration: 0.06, amplitude: 0.16, pauseAfter: 0.018),
            ToneStep(frequency: 940, duration: 0.08, amplitude: 0.15, pauseAfter: 0)
        ]
    )

    private lazy var clipSavedBuffer = makeBuffer(
        tones: [
            ToneStep(frequency: 720, duration: 0.05, amplitude: 0.15, pauseAfter: 0.015),
            ToneStep(frequency: 980, duration: 0.07, amplitude: 0.17, pauseAfter: 0.015),
            ToneStep(frequency: 1_260, duration: 0.11, amplitude: 0.14, pauseAfter: 0)
        ]
    )

    private init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 0.8
        try? engine.start()
    }

    func play(_ effect: ClipSoundEffect) {
        guard let buffer = buffer(for: effect) else { return }

        if !engine.isRunning {
            try? engine.start()
        }

        player.stop()
        player.scheduleBuffer(buffer, at: nil, options: [])
        player.play()
    }

    private func buffer(for effect: ClipSoundEffect) -> AVAudioPCMBuffer? {
        switch effect {
        case .clipStarted:
            return clipStartedBuffer
        case .clipSaved:
            return clipSavedBuffer
        }
    }

    private func makeBuffer(tones: [ToneStep]) -> AVAudioPCMBuffer? {
        guard let format else { return nil }

        let sampleRate = format.sampleRate
        let totalFrameCount = tones.reduce(0) { partialResult, tone in
            partialResult + Int((tone.duration + tone.pauseAfter) * sampleRate)
        }

        guard totalFrameCount > 0,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(totalFrameCount)
              ),
              let channelData = buffer.floatChannelData?[0] else {
            return nil
        }

        buffer.frameLength = AVAudioFrameCount(totalFrameCount)
        for index in 0..<totalFrameCount {
            channelData[index] = 0
        }

        var currentFrame = 0
        for tone in tones {
            let toneFrameCount = Int(tone.duration * sampleRate)
            let pauseFrameCount = Int(tone.pauseAfter * sampleRate)
            let fadeFrameCount = max(1, Int(0.012 * sampleRate))

            for frame in 0..<toneFrameCount {
                let time = Double(frame) / sampleRate
                let sample = sin(2 * Double.pi * tone.frequency * time)
                let fadeIn = min(1, Double(frame) / Double(fadeFrameCount))
                let fadeOut = min(1, Double(toneFrameCount - frame) / Double(fadeFrameCount))
                let envelope = Float(fadeIn * fadeOut)
                channelData[currentFrame + frame] = Float(sample) * tone.amplitude * envelope
            }

            currentFrame += toneFrameCount + pauseFrameCount
        }

        return buffer
    }
}