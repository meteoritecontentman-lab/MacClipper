import AVFoundation
import AppKit
import CoreAudio

@MainActor
final class AudioEngineManager: ObservableObject {
    let mixer: AudioMixer
    let microphone: MicrophoneCapture
    let systemAudio: SystemAudioCapture

    @Published private(set) var isRunning = false
    @Published private(set) var statusText = "Ready"
    @Published private(set) var hasHeadphones = false

    private var deviceListener: AudioObjectPropertyListenerBlock?

    var micVolume: Float {
        get { microphone.config.volume }
        set {
            microphone.config.volume = newValue
            mixer.setVolume(newValue, for: .microphone)
        }
    }

    var systemVolume: Float {
        get { systemAudio.config.volume }
        set {
            systemAudio.config.volume = newValue
            mixer.setVolume(newValue, for: .systemAudio)
        }
    }

    var masterVolume: Float {
        get { mixer.masterVolume }
        set { mixer.masterVolume = newValue }
    }

    init() {
        mixer = AudioMixer()
        microphone = MicrophoneCapture()
        systemAudio = SystemAudioCapture()

        microphone.setMixer(mixer)
        systemAudio.setMixer(mixer)
    }

    func start() async throws {
        statusText = "Starting audio engine..."

        try mixer.start()
        mixer.addSource(id: .microphone, format: standardAudioFormat())
        mixer.addSource(id: .systemAudio, format: standardAudioFormat())

        do {
            try await microphone.start()
            statusText = "Microphone active"
        } catch {
            statusText = "Mic unavailable: \(error.localizedDescription)"
        }

        do {
            try await systemAudio.start()
            statusText = "Desktop audio active"
        } catch {
            statusText = "System audio unavailable: \(error.localizedDescription)"
        }

        startHeadphoneMonitoring()
        isRunning = true
    }

    func stop() {
        stopHeadphoneMonitoring()
        microphone.stop()
        systemAudio.stop()
        mixer.stop()
        isRunning = false
        statusText = "Stopped"
    }

    private func startHeadphoneMonitoring() {
        updateHeadphoneStatus()

        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            Task { @MainActor in
                self?.updateHeadphoneStatus()
            }
        }
        deviceListener = block

        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            nil,
            block
        )
    }

    private func stopHeadphoneMonitoring() {
        guard let block = deviceListener else { return }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectRemovePropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            nil,
            block
        )
        deviceListener = nil
    }

    private func updateHeadphoneStatus() {
        hasHeadphones = AudioEngineManager.isHeadphonesOutput()
    }

    static func isHeadphonesOutput() -> Bool {
        var deviceID = AudioDeviceID()
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address, 0, nil, &size, &deviceID
        ) == noErr, deviceID > 0 else { return false }

        var name: CFString?
        var nameSize = UInt32(MemoryLayout<CFString?>.size)
        var nameAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(deviceID, &nameAddress, 0, nil, &nameSize, &name) == noErr,
              let name else { return false }

        let lower = (name as String).lowercased()
        return lower.contains("headphone") || lower.contains("headset") ||
               lower.contains("airpods") || lower.contains("earphone") ||
               lower.contains("buds") || lower.contains("bluetooth")
    }

    func toggleSource(_ id: AudioSourceID) {
        switch id {
        case .microphone:
            microphone.config.enabled.toggle()
            if microphone.config.enabled {
                Task { try? await microphone.start() }
            } else {
                microphone.stop()
            }
        case .systemAudio:
            systemAudio.config.enabled.toggle()
            if systemAudio.config.enabled {
                Task { try? await systemAudio.start() }
            } else {
                systemAudio.stop()
            }
        }
    }

    private func standardAudioFormat() -> AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 48000,
            channels: 2,
            interleaved: false
        ) ?? AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
    }
}
