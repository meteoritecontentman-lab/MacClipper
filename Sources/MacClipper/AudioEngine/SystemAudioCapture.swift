import ScreenCaptureKit
@preconcurrency import AVFoundation
import CoreMedia
import AppKit

@MainActor
final class SystemAudioCapture: NSObject, AudioSource {
    let id: AudioSourceID = .systemAudio
    private(set) var state: AudioSourceState = .idle
    var config: AudioSourceConfig = .default

    private weak var mixer: AudioMixer?
    private var stream: SCStream?
    private let captureQueue = DispatchQueue(label: "local.macclipper.sysaudio-capture", qos: .userInitiated)

    private nonisolated(unsafe) var converter: AVAudioConverter?
    private let standardFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 48000,
        channels: 2,
        interleaved: false
    )!

    func setMixer(_ mixer: AudioMixer) {
        self.mixer = mixer
    }

    func start() async throws {
        state = .starting

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            state = .failed("No display found for screen capture")
            throw AudioEngineError.systemAudioTapFailed
        }

        let excludedApps = content.apps.filter { app in
            app.bundleIdentifier == Bundle.main.bundleIdentifier
        }

        let filter = SCContentFilter(display: display, excludingApplications: excludedApps)

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.showsCursor = false
        config.width = 1
        config.height = 1
        config.minimumFrameInterval = CMTime(value: 1, timescale: 10)

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        self.stream = stream

        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: captureQueue)

        try await stream.startCapture()

        state = .active
    }

    func stop() {
        guard let stream else { return }
        Task { @MainActor in
            try? await stream.stopCapture()
            self.stream = nil
            self.converter = nil
        }
        state = .idle
    }
}

extension SystemAudioCapture: SCStreamOutput {
    nonisolated func stream(_ stream: SCStream, didOutput sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio,
              let formatDesc = sampleBuffer.formatDescription,
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }

        let asbd = asbdPtr.pointee
        let frameCount = sampleBuffer.numSamples
        guard frameCount > 0 else { return }

        let sourceFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: asbd.mSampleRate,
            channels: asbd.mChannelsPerFrame,
            interleaved: false
        )

        guard let sourceFormat, let sourceBuffer = AVAudioPCMBuffer(
            pcmFormat: sourceFormat,
            frameCapacity: AVAudioFrameCount(frameCount)
        ) else { return }

        sourceBuffer.frameLength = AVAudioFrameCount(frameCount)

        guard let dataBuffer = sampleBuffer.dataBuffer else { return }

        var pointer: UnsafeMutablePointer<CChar>?
        var length: Int = 0
        guard CMBlockBufferGetDataPointer(dataBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer) == noErr,
              let floatPtr = pointer?.withMemoryRebound(to: Float.self, capacity: length / MemoryLayout<Float>.stride, { $0 }) else {
            return
        }

        let channelCount = Int(asbd.mChannelsPerFrame)
        let totalFrames = Int(frameCount)
        let floatData = UnsafeBufferPointer(start: floatPtr, count: totalFrames * channelCount)

        for channel in 0..<min(channelCount, Int(sourceFormat.channelCount)) {
            guard let dest = sourceBuffer.floatChannelData?[channel] else { continue }
            for frame in 0..<totalFrames {
                dest[frame] = floatData[frame * channelCount + channel]
            }
        }

        guard let convertedBuffer = convertToStandard(sourceBuffer, format: sourceFormat) else { return }

        Task { @MainActor [weak self] in
            guard let mixer = self?.mixer, mixer.engine.isRunning else { return }
            mixer.scheduleBuffer(convertedBuffer, for: .systemAudio)
        }
    }

    private nonisolated func convertToStandard(_ source: AVAudioPCMBuffer, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let standard = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 48000.0,
            channels: 2,
            interleaved: false
        )!

        if format.sampleRate == standard.sampleRate && format.channelCount == standard.channelCount {
            return source
        }

        if converter == nil || converter?.inputFormat != format {
            converter = AVAudioConverter(from: format, to: standard)
        }

        guard let converter else { return nil }

        let capacity = AVAudioFrameCount(Double(source.frameLength) * standard.sampleRate / format.sampleRate) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: standard, frameCapacity: capacity) else { return nil }

        var error: NSError?
        let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
            outStatus.pointee = .haveData
            return source
        }

        converter.convert(to: output, error: &error, withInputFrom: inputBlock)
        output.frameLength = output.frameCapacity

        return output
    }
}
