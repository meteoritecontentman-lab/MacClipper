import AVFoundation
import Combine
import Foundation

final class MicrophoneTestMonitor: NSObject, ObservableObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    @Published private(set) var isRunning = false
    @Published private(set) var level: Double = 0
    @Published private(set) var statusText: String = "Ready to test your microphone."
    @Published private(set) var activeInputName: String = ""

    private let sessionQueue = DispatchQueue(label: "MacClipper.microphone-test.session")
    private let captureSession = AVCaptureSession()
    private let audioOutput = AVCaptureAudioDataOutput()

    private var currentInput: AVCaptureDeviceInput?
    private var lastSignalAt: Date?

    func start(preferredDeviceID: String?) {
        sessionQueue.async { [weak self] in
            guard let self else { return }

            do {
                let microphone = try self.configureSessionLocked(preferredDeviceID: preferredDeviceID)
                if !self.captureSession.isRunning {
                    self.captureSession.startRunning()
                }

                let microphoneName = microphone.localizedName
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.activeInputName = microphoneName
                    self.isRunning = self.captureSession.isRunning
                    self.level = 0
                    self.statusText = self.captureSession.isRunning
                        ? "Listening on \(microphoneName). Talk normally to test the input."
                        : "MacClipper could not start the microphone test."
                }
            } catch {
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.isRunning = false
                    self.level = 0
                    self.statusText = error.localizedDescription
                }
            }
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self else { return }

            if self.captureSession.isRunning {
                self.captureSession.stopRunning()
            }

            self.captureSession.beginConfiguration()
            if let currentInput {
                self.captureSession.removeInput(currentInput)
                self.currentInput = nil
            }
            if self.captureSession.outputs.contains(where: { $0 === self.audioOutput }) {
                self.captureSession.removeOutput(self.audioOutput)
            }
            self.captureSession.commitConfiguration()

            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isRunning = false
                self.level = 0
                self.activeInputName = ""
                self.statusText = "Ready to test your microphone."
            }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let measuredLevel = Self.audioLevel(from: sampleBuffer) else { return }

        let now = Date()
        let smoothedLevel = measuredLevel > 0.02 ? min(1, (measuredLevel * 1.7) + 0.08) : measuredLevel * 0.55

        if measuredLevel > 0.02 {
            lastSignalAt = now
        }

        Task { @MainActor [weak self] in
            guard let self else { return }
            let decayedLevel = max(smoothedLevel, self.level * 0.45)
            self.level = decayedLevel

            guard self.isRunning else { return }

            if measuredLevel > 0.02 {
                self.statusText = "Mic signal detected on \(self.activeInputName.isEmpty ? "your selected input" : self.activeInputName)."
            } else if let lastSignalAt = self.lastSignalAt, now.timeIntervalSince(lastSignalAt) < 1.5 {
                self.statusText = "Signal looks good. Keep talking if you want to verify the meter."
            } else {
                self.statusText = "Listening on \(self.activeInputName.isEmpty ? "your selected input" : self.activeInputName). If the meter stays flat, check the mic and macOS input volume."
            }
        }
    }

    private func configureSessionLocked(preferredDeviceID: String?) throws -> AVCaptureDevice {
        if captureSession.isRunning {
            captureSession.stopRunning()
        }

        captureSession.beginConfiguration()

        if let currentInput {
            captureSession.removeInput(currentInput)
            self.currentInput = nil
        }

        if captureSession.outputs.contains(where: { $0 === audioOutput }) {
            captureSession.removeOutput(audioOutput)
        }

        audioOutput.audioSettings = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]
        audioOutput.setSampleBufferDelegate(self, queue: sessionQueue)

        guard captureSession.canAddOutput(audioOutput) else {
            captureSession.commitConfiguration()
            throw MicrophoneTestError.unableToStart
        }
        captureSession.addOutput(audioOutput)

        guard let microphone = Self.preferredMicrophone(preferredDeviceID: preferredDeviceID) else {
            captureSession.commitConfiguration()
            throw MicrophoneTestError.noInputAvailable
        }

        let input = try AVCaptureDeviceInput(device: microphone)
        guard captureSession.canAddInput(input) else {
            captureSession.commitConfiguration()
            throw MicrophoneTestError.unavailableInput(microphone.localizedName)
        }

        captureSession.addInput(input)
        currentInput = input
        captureSession.commitConfiguration()
        lastSignalAt = nil
        return microphone
    }

    private static func preferredMicrophone(preferredDeviceID: String?) -> AVCaptureDevice? {
        let devices = AudioCaptureDeviceCatalog.devices()

        if let preferredDeviceID,
           !preferredDeviceID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let device = devices.first(where: { $0.uniqueID == preferredDeviceID }) {
            return device
        }

        return AudioCaptureDeviceCatalog.preferredDevice(preferredUniqueID: nil)
    }

    private static func audioLevel(from sampleBuffer: CMSampleBuffer) -> Double? {
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return nil }

        var audioBufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(mNumberChannels: 0, mDataByteSize: 0, mData: nil)
        )
        var blockBuffer: CMBlockBuffer?

        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &audioBufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &blockBuffer
        )

        guard status == noErr else { return nil }

        let buffers = UnsafeMutableAudioBufferListPointer(&audioBufferList)
        var accumulatedPower = 0.0
        var sampleCount = 0

        for buffer in buffers {
            guard let data = buffer.mData else { continue }
            let samples = data.assumingMemoryBound(to: Int16.self)
            let count = Int(buffer.mDataByteSize) / MemoryLayout<Int16>.size
            guard count > 0 else { continue }

            for index in 0..<count {
                let normalizedSample = Double(samples[index]) / Double(Int16.max)
                accumulatedPower += normalizedSample * normalizedSample
            }
            sampleCount += count
        }

        guard sampleCount > 0 else { return 0 }
        let rms = sqrt(accumulatedPower / Double(sampleCount))
        guard rms.isFinite else { return 0 }

        let decibels = 20 * log10(max(rms, 0.000_01))
        return min(1, max(0, (decibels + 55) / 55))
    }
}

private enum MicrophoneTestError: LocalizedError {
    case noInputAvailable
    case unavailableInput(String)
    case unableToStart

    var errorDescription: String? {
        switch self {
        case .noInputAvailable:
            return "No microphone input is available for the test."
        case .unavailableInput(let inputName):
            return "MacClipper could not start the test on \(inputName)."
        case .unableToStart:
            return "MacClipper could not start the microphone test."
        }
    }
}