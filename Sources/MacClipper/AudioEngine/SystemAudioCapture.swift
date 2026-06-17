import AVFoundation
import AppKit
import CoreAudio

@MainActor
final class SystemAudioCapture: AudioSource {
    let id: AudioSourceID = .systemAudio
    private(set) var state: AudioSourceState = .idle
    var config: AudioSourceConfig = .default

    private weak var mixer: AudioMixer?

    func setMixer(_ mixer: AudioMixer) {
        self.mixer = mixer
    }

    func start() async throws {
        state = .active
    }

    func stop() {
        state = .idle
    }
}
