@preconcurrency import AVFoundation
import AppKit
import CoreMedia

final class MicrophoneCapture: NSObject, AudioSource {
    let id: AudioSourceID = .microphone
    private(set) var state: AudioSourceState = .idle
    var config: AudioSourceConfig = .default

    private var captureSession: AVCaptureSession?
    private var audioOutput: AVCaptureAudioDataOutput?
    private weak var mixer: AudioMixer?
    private let captureQueue = DispatchQueue(label: "local.macclipper.mic-capture", qos: .userInitiated)

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

        guard let device = AVCaptureDevice.default(for: .audio) else {
            state = .failed("No microphone found")
            throw AudioEngineError.noMicrophone
        }

        let session = AVCaptureSession()
        session.sessionPreset = .medium

        guard let input = try? AVCaptureDeviceInput(device: device) else {
            state = .failed("Could not open microphone")
            throw AudioEngineError.microphoneInitFailed
        }

        guard session.canAddInput(input) else {
            state = .failed("Microphone input not available")
            throw AudioEngineError.microphoneInitFailed
        }
        session.addInput(input)

        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: captureQueue)
        guard session.canAddOutput(output) else {
            state = .failed("Microphone output not available")
            throw AudioEngineError.microphoneInitFailed
        }
        session.addOutput(output)
        audioOutput = output

        captureSession = session
        captureQueue.async { [weak session] in
            session?.startRunning()
        }

        state = .active
    }

    func stop() {
        captureSession?.stopRunning()
        captureSession = nil
        audioOutput = nil
        converter = nil
        state = .idle
    }
}

extension MicrophoneCapture: AVCaptureAudioDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let formatDesc = sampleBuffer.formatDescription,
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
            mixer.scheduleBuffer(convertedBuffer, for: .microphone)
        }
    }

    private nonisolated func convertToStandard(_ source: AVAudioPCMBuffer, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        if format.sampleRate == standardFormat.sampleRate && format.channelCount == standardFormat.channelCount {
            return source
        }

        if converter == nil || converter?.inputFormat != format {
            converter = AVAudioConverter(from: format, to: standardFormat)
        }

        guard let converter else { return nil }

        let capacity = AVAudioFrameCount(Double(source.frameLength) * standardFormat.sampleRate / format.sampleRate) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: standardFormat, frameCapacity: capacity) else { return nil }

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

enum AudioEngineError: LocalizedError, Sendable {
    case noMicrophone
    case microphoneInitFailed
    case systemAudioTapFailed
    case engineStartFailed

    var errorDescription: String? {
        switch self {
        case .noMicrophone: return "No microphone found"
        case .microphoneInitFailed: return "Could not initialize microphone capture"
        case .systemAudioTapFailed: return "System audio capture failed"
        case .engineStartFailed: return "Audio engine failed to start"
        }
    }
}
