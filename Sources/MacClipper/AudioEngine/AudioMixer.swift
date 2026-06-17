import AVFoundation
import AppKit

@MainActor
final class AudioMixer {
    let engine: AVAudioEngine
    private let mainMixer: AVAudioMixerNode
    private var sourceNodes: [AudioSourceID: AVAudioPlayerNode] = [:]
    private var sourceConverters: [AudioSourceID: AVAudioConverter] = [:]

    var masterVolume: Float {
        get { mainMixer.outputVolume }
        set { mainMixer.outputVolume = newValue }
    }

    init() {
        engine = AVAudioEngine()
        mainMixer = engine.mainMixerNode

        // Disconnect hardware input — we capture mic via AVCaptureSession
        engine.disconnectNodeInput(engine.mainMixerNode)

        // Mute all output — no audio reaches speakers
        mainMixer.outputVolume = 0

        engine.prepare()
    }

    func start() throws {
        try engine.start()
    }

    func stop() {
        engine.stop()
        sourceNodes.values.forEach { $0.stop() }
        sourceNodes.removeAll()
        sourceConverters.removeAll()
    }

    func addSource(id: AudioSourceID, format: AVAudioFormat) {
        guard sourceNodes[id] == nil else { return }

        let playerNode = AVAudioPlayerNode()
        engine.attach(playerNode)
        engine.connect(playerNode, to: mainMixer, format: format)
        playerNode.volume = 0.0
        playerNode.pan = 0.0
        sourceNodes[id] = playerNode
    }

    func removeSource(id: AudioSourceID) {
        guard let node = sourceNodes.removeValue(forKey: id) else { return }
        node.stop()
        engine.detach(node)
        sourceConverters.removeValue(forKey: id)
    }

    func scheduleBuffer(_ buffer: AVAudioPCMBuffer, for id: AudioSourceID) {
        guard let node = sourceNodes[id] else { return }
        node.scheduleBuffer(buffer)
        if !node.isPlaying {
            node.play()
        }
    }

    func setVolume(_ volume: Float, for id: AudioSourceID) {
        sourceNodes[id]?.volume = volume
    }

    func setPan(_ pan: Float, for id: AudioSourceID) {
        sourceNodes[id]?.pan = pan
    }

    var isRunning: Bool {
        engine.isRunning
    }
}
