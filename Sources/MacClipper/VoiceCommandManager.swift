import AVFoundation
import Foundation
@preconcurrency import Speech

private enum VoiceCommandError: LocalizedError {
    case noMicrophoneAvailable
    case unableToAddInput(String)
    case unableToAddOutput

    var errorDescription: String? {
        switch self {
        case .noMicrophoneAvailable:
            return "No microphone input is available."
        case .unableToAddInput(let deviceName):
            return "Could not use \(deviceName) for voice commands."
        case .unableToAddOutput:
            return "Could not start the voice command audio pipeline."
        }
    }
}

final class VoiceCommandManager: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    private struct ExternalPCMBuffer: @unchecked Sendable {
        let buffer: AVAudioPCMBuffer
    }

    private enum AudioInputMode {
        case dedicatedCapture
        case externalMicrophoneFeed
    }

    private let sessionQueue = DispatchQueue(label: "MacClipper.voice-command.session")
    private let captureSession = AVCaptureSession()
    private let audioOutput = AVCaptureAudioDataOutput()
    private var triggerCommands = [
        "Mac clip that",
        "MacClip that"
    ]
    private var normalizedTriggerCommands = [
        "mac clip that",
        "macclip that"
    ]

    func setCustomTriggerCommand(_ phrase: String) {
        let trimmed = phrase.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            resetTriggerCommands()
            return
        }
        let normalized = trimmed.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current).lowercased()
        sessionQueue.async {
            self.triggerCommands = [trimmed]
            self.normalizedTriggerCommands = [normalized]
            guard self.requestedStart else { return }
            self.restartListeningLocked(reason: "custom trigger command updated")
        }
    }

    private func resetTriggerCommands() {
        sessionQueue.async {
            self.triggerCommands = ["Mac clip that", "MacClip that"]
            self.normalizedTriggerCommands = ["mac clip that", "macclip that"]
            guard self.requestedStart else { return }
            self.restartListeningLocked(reason: "trigger commands reset to default")
        }
    }
    private let minimumRecognitionInterval: TimeInterval = 2
    private let recognitionRestartDelay: TimeInterval = 0.35

    var onClipCommand: ((String) -> Void)?

    private var preferredMicrophoneDeviceID: String?
    private var audioInputMode: AudioInputMode = .dedicatedCapture
    private var currentInput: AVCaptureDeviceInput?
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var pendingRestartWorkItem: DispatchWorkItem?
    private var requestedStart = false
    private var isListening = false
    private var lastRecognitionAt: Date?
    private var recognitionGeneration = 0
    private var startGeneration = 0
    private var supportsExternalMicrophoneFeed = true
    private var hasLoggedExternalMicrophoneFeedFallback = false

    private lazy var speechRecognizer: SFSpeechRecognizer? = {
        SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer()
    }()

    private let captureAudioSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false
    ]

    func setPreferredMicrophoneDeviceID(_ deviceID: String?) {
        let normalizedDeviceID = Self.normalizedMicrophoneDeviceID(deviceID)

        sessionQueue.async {
            guard self.preferredMicrophoneDeviceID != normalizedDeviceID else { return }
            self.preferredMicrophoneDeviceID = normalizedDeviceID
            self.resetExternalMicrophoneFeedSupportLocked()

            guard self.requestedStart else { return }
            self.restartListeningLocked(reason: "microphone selection changed")
        }
    }

    func setUsesExternalMicrophoneFeed(_ usesExternalMicrophoneFeed: Bool) {
        sessionQueue.async {
            let mode: AudioInputMode
            if usesExternalMicrophoneFeed, self.supportsExternalMicrophoneFeed {
                mode = .externalMicrophoneFeed
            } else {
                if usesExternalMicrophoneFeed, !self.hasLoggedExternalMicrophoneFeedFallback {
                    self.hasLoggedExternalMicrophoneFeedFallback = true
                    AppLogger.shared.log("Voice", "shared recorder microphone feed unavailable in this session; using dedicated microphone capture")
                }
                mode = .dedicatedCapture
            }

            guard self.audioInputMode != mode else { return }
            self.audioInputMode = mode

            guard self.requestedStart else { return }
            self.restartListeningLocked(reason: usesExternalMicrophoneFeed ? "switching to recorder microphone feed" : "switching to dedicated microphone capture")
        }
    }

    func appendExternalAudioSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        guard shouldAcceptExternalMicrophoneSamples() else { return }
        guard let pcmBuffer = makeExternalPCMBuffer(from: sampleBuffer) else { return }

        sessionQueue.async {
            guard self.audioInputMode == .externalMicrophoneFeed else { return }
            guard self.requestedStart, self.isListening else { return }
            guard let speechRequest = self.speechRequest else { return }
            self.appendPCMBufferToSpeechRequest(pcmBuffer.buffer, request: speechRequest)
        }
    }

    func start() {
        sessionQueue.async {
            self.requestedStart = true
            self.startGeneration += 1
            let generation = self.startGeneration

            Task { [weak self] in
                guard let self else { return }

                let microphoneAuthorized = await Self.ensureMicrophoneAuthorization()
                let speechAuthorized = await Self.ensureSpeechAuthorization()

                self.sessionQueue.async {
                    guard self.requestedStart else { return }
                    guard self.startGeneration == generation else { return }

                    if self.isListening {
                        return
                    }

                    guard microphoneAuthorized else {
                        AppLogger.shared.log("Voice", "voice command listener blocked: microphone permission not granted")
                        return
                    }

                    guard speechAuthorized else {
                        AppLogger.shared.log("Voice", "voice command listener blocked: speech recognition permission not granted")
                        return
                    }

                    self.beginListeningLocked()
                }
            }
        }
    }

    func stop() {
        sessionQueue.async {
            self.requestedStart = false
            self.startGeneration += 1
            self.pendingRestartWorkItem?.cancel()
            self.pendingRestartWorkItem = nil
            self.stopListeningLocked(reason: "stopped")
        }
    }

    private func beginListeningLocked() {
        pendingRestartWorkItem?.cancel()
        pendingRestartWorkItem = nil

        guard let speechRecognizer else {
            AppLogger.shared.log("Voice", "voice command listener unavailable: speech recognizer not available")
            return
        }

        if !speechRecognizer.isAvailable && !speechRecognizer.supportsOnDeviceRecognition {
            AppLogger.shared.log("Voice", "voice command listener waiting: speech recognizer unavailable")
            scheduleRestartLocked(reason: "speech recognizer unavailable")
            return
        }

        switch audioInputMode {
        case .dedicatedCapture:
            do {
                try configureCaptureSessionLocked()
            } catch {
                AppLogger.shared.log("Voice", "voice command listener failed to configure message=\(error.localizedDescription)")
                scheduleRestartLocked(reason: "audio pipeline unavailable")
                return
            }

            startRecognitionTaskLocked(with: speechRecognizer)

            if !captureSession.isRunning {
                captureSession.startRunning()
            }

            guard captureSession.isRunning else {
                stopRecognitionTaskLocked()
                AppLogger.shared.log("Voice", "voice command listener failed to start capture session")
                scheduleRestartLocked(reason: "capture session failed to start")
                return
            }
        case .externalMicrophoneFeed:
            if captureSession.isRunning {
                captureSession.stopRunning()
            }
            startRecognitionTaskLocked(with: speechRecognizer)
        }

        isListening = true
        AppLogger.shared.log(
            "Voice",
            "voice command listener started phrase=Mac clip that microphone=\(activeMicrophoneDescriptionLocked()) mode=\(audioInputModeDescriptionLocked())"
        )
    }

    private func stopListeningLocked(reason: String) {
        let wasListening = isListening
        tearDownListeningLocked()

        if wasListening {
            AppLogger.shared.log("Voice", "voice command listener stopped reason=\(reason)")
        }
    }

    private func restartListeningLocked(reason: String) {
        AppLogger.shared.log("Voice", "voice command listener restarting reason=\(reason)")
        tearDownListeningLocked()

        guard requestedStart else { return }
        beginListeningLocked()
    }

    private func tearDownListeningLocked() {
        stopRecognitionTaskLocked()

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
        captureSession.commitConfiguration()

        isListening = false
    }

    private func configureCaptureSessionLocked() throws {
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

        audioOutput.audioSettings = captureAudioSettings
        audioOutput.setSampleBufferDelegate(self, queue: sessionQueue)
        guard captureSession.canAddOutput(audioOutput) else {
            captureSession.commitConfiguration()
            throw VoiceCommandError.unableToAddOutput
        }
        captureSession.addOutput(audioOutput)

        guard let microphone = preferredMicrophoneLocked() else {
            captureSession.commitConfiguration()
            throw VoiceCommandError.noMicrophoneAvailable
        }

        let input = try AVCaptureDeviceInput(device: microphone)
        guard captureSession.canAddInput(input) else {
            captureSession.commitConfiguration()
            throw VoiceCommandError.unableToAddInput(microphone.localizedName)
        }

        captureSession.addInput(input)
        currentInput = input
        captureSession.commitConfiguration()
    }

    private func startRecognitionTaskLocked(with speechRecognizer: SFSpeechRecognizer) {
        stopRecognitionTaskLocked()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.contextualStrings = triggerCommands
        if speechRecognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        speechRequest = request
        recognitionGeneration += 1
        let generation = recognitionGeneration

        recognitionTask = speechRecognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let manager = self else { return }

            let transcript = result?.bestTranscription.formattedString ?? ""
            let isFinal = result?.isFinal ?? false
            let errorMessage = error?.localizedDescription

            manager.sessionQueue.async {
                manager.handleRecognitionUpdate(
                    transcript: transcript,
                    isFinal: isFinal,
                    errorMessage: errorMessage,
                    generation: generation
                )
            }
        }
    }

    private func stopRecognitionTaskLocked() {
        recognitionGeneration += 1
        speechRequest?.endAudio()
        speechRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
    }

    private func handleRecognitionUpdate(
        transcript: String,
        isFinal: Bool,
        errorMessage: String?,
        generation: Int
    ) {
        guard generation == recognitionGeneration else { return }

        if let errorMessage {
            AppLogger.shared.log("Voice", "voice recognition error message=\(errorMessage)")
            scheduleRestartLocked(reason: "recognizer error")
            return
        }

        let normalizedTranscript = Self.normalizedTranscript(transcript)

        if let matchedCommand = matchedTriggerCommand(in: normalizedTranscript) {
            let now = Date()
            if let lastRecognitionAt, now.timeIntervalSince(lastRecognitionAt) < minimumRecognitionInterval {
                AppLogger.shared.log("Voice", "voice command ignored duplicate=\(matchedCommand)")
            } else {
                lastRecognitionAt = now
                AppLogger.shared.log("Voice", "voice command recognized=\(matchedCommand)")
                onClipCommand?(matchedCommand)
            }

            restartRecognitionTaskLocked(reason: "command matched")
            return
        }

        if isFinal {
            restartRecognitionTaskLocked(reason: "final result")
        }
    }

    private func restartRecognitionTaskLocked(reason: String) {
        guard requestedStart else { return }

        guard let speechRecognizer else {
            scheduleRestartLocked(reason: reason)
            return
        }

        if audioInputMode == .dedicatedCapture && !captureSession.isRunning {
            scheduleRestartLocked(reason: reason)
            return
        }

        AppLogger.shared.log("Voice", "voice recognition pipeline restarting reason=\(reason)")
        startRecognitionTaskLocked(with: speechRecognizer)
    }

    private func scheduleRestartLocked(reason: String) {
        guard requestedStart else { return }

        pendingRestartWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self, self.requestedStart else { return }
            self.restartListeningLocked(reason: reason)
        }

        pendingRestartWorkItem = workItem
        sessionQueue.asyncAfter(deadline: .now() + recognitionRestartDelay, execute: workItem)
    }

    private func preferredMicrophoneLocked() -> AVCaptureDevice? {
        let devices = AudioCaptureDeviceCatalog.devices()

        if let preferredMicrophoneDeviceID,
           let preferredDevice = devices.first(where: { $0.uniqueID == preferredMicrophoneDeviceID }) {
            return preferredDevice
        }

        if let preferredMicrophoneDeviceID {
            AppLogger.shared.log(
                "Voice",
                "selected microphone unavailable id=\(preferredMicrophoneDeviceID); falling back to system default"
            )
        }

        return AudioCaptureDeviceCatalog.preferredDevice(preferredUniqueID: nil)
    }

    private func activeMicrophoneDescriptionLocked() -> String {
        switch audioInputMode {
        case .dedicatedCapture:
            return currentInput?.device.localizedName ?? "System Default"
        case .externalMicrophoneFeed:
            if let preferredMicrophoneDeviceID,
               let preferredDevice = AudioCaptureDeviceCatalog.device(withUniqueID: preferredMicrophoneDeviceID) {
                return preferredDevice.localizedName
            }
            return "Recorder Microphone Feed"
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard audioInputMode == .dedicatedCapture else { return }
        guard requestedStart, isListening else { return }
        appendSampleBufferToSpeechRequestLocked(sampleBuffer)
    }

    private func shouldAcceptExternalMicrophoneSamples() -> Bool {
        sessionQueue.sync {
            audioInputMode == .externalMicrophoneFeed && requestedStart && isListening && speechRequest != nil
        }
    }

    private func appendSampleBufferToSpeechRequestLocked(_ sampleBuffer: CMSampleBuffer) {
        guard let speechRequest else { return }
        appendSampleBufferToSpeechRequest(sampleBuffer, request: speechRequest)
    }

    private func appendPCMBufferToSpeechRequest(
        _ pcmBuffer: AVAudioPCMBuffer,
        request: SFSpeechAudioBufferRecognitionRequest
    ) {
        request.append(pcmBuffer)
    }

    private func appendSampleBufferToSpeechRequest(
        _ sampleBuffer: CMSampleBuffer,
        request: SFSpeechAudioBufferRecognitionRequest
    ) {
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard CMSampleBufferGetNumSamples(sampleBuffer) > 0 else { return }
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
        guard CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) != nil else { return }
        request.appendAudioSampleBuffer(sampleBuffer)
    }

    private func makeExternalPCMBuffer(from sampleBuffer: CMSampleBuffer) -> ExternalPCMBuffer? {
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return nil }

        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frameCount > 0 else { return nil }
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else { return nil }
        guard let streamDescriptionPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed has no audio stream description")
            return nil
        }

        let streamDescription = streamDescriptionPointer.pointee
        guard streamDescription.mFormatID == kAudioFormatLinearPCM else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed is not linear PCM formatID=\(Self.fourCharacterCode(streamDescription.mFormatID))")
            return nil
        }
        guard streamDescription.mChannelsPerFrame > 0 else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed reported zero channels")
            return nil
        }
        guard streamDescription.mBytesPerFrame > 0 else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed reported zero bytes per frame")
            return nil
        }
        guard streamDescription.mSampleRate > 0 else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed reported invalid sample rate")
            return nil
        }
        guard let commonFormat = Self.commonPCMFormat(for: streamDescription) else {
            disableExternalMicrophoneFeed(
                reason: "shared recorder microphone feed uses unsupported PCM bit depth=\(streamDescription.mBitsPerChannel) flags=\(streamDescription.mFormatFlags)"
            )
            return nil
        }
        guard let pcmFormat = AVAudioFormat(
            commonFormat: commonFormat,
            sampleRate: streamDescription.mSampleRate,
            channels: streamDescription.mChannelsPerFrame,
            interleaved: Self.isInterleavedPCM(streamDescription)
        ) else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed could not create AVAudioFormat")
            return nil
        }

        guard let pcmBuffer = AVAudioPCMBuffer(
            pcmFormat: pcmFormat,
            frameCapacity: AVAudioFrameCount(frameCount)
        ) else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed could not allocate PCM buffer")
            return nil
        }

        let copyStatus = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer,
            at: 0,
            frameCount: Int32(frameCount),
            into: pcmBuffer.mutableAudioBufferList
        )

        guard copyStatus == noErr else {
            disableExternalMicrophoneFeed(reason: "shared recorder microphone feed PCM copy failed status=\(copyStatus)")
            return nil
        }

        pcmBuffer.frameLength = AVAudioFrameCount(frameCount)
        return ExternalPCMBuffer(buffer: pcmBuffer)
    }

    private func disableExternalMicrophoneFeed(reason: String) {
        sessionQueue.async {
            self.disableExternalMicrophoneFeedLocked(reason: reason)
        }
    }

    private func disableExternalMicrophoneFeedLocked(reason: String) {
        guard supportsExternalMicrophoneFeed else { return }

        supportsExternalMicrophoneFeed = false
        hasLoggedExternalMicrophoneFeedFallback = true
        AppLogger.shared.log("Voice", "\(reason); falling back to dedicated microphone capture")

        guard requestedStart else {
            audioInputMode = .dedicatedCapture
            return
        }

        guard audioInputMode == .externalMicrophoneFeed else {
            return
        }

        audioInputMode = .dedicatedCapture
        restartListeningLocked(reason: "shared recorder microphone feed unsupported")
    }

    private func resetExternalMicrophoneFeedSupportLocked() {
        supportsExternalMicrophoneFeed = true
        hasLoggedExternalMicrophoneFeedFallback = false
    }

    private func audioInputModeDescriptionLocked() -> String {
        switch audioInputMode {
        case .dedicatedCapture:
            return "dedicated"
        case .externalMicrophoneFeed:
            return "shared-recorder-feed"
        }
    }

    private func matchedTriggerCommand(in normalizedTranscript: String) -> String? {
        for (index, normalizedCommand) in normalizedTriggerCommands.enumerated() {
            if normalizedTranscript.contains(normalizedCommand) {
                return triggerCommands[index]
            }
        }

        return nil
    }

    private static func normalizedTranscript(_ transcript: String) -> String {
        let folded = transcript
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased()

        let sanitized = folded.unicodeScalars.map { scalar -> String in
            if CharacterSet.alphanumerics.contains(scalar) || CharacterSet.whitespacesAndNewlines.contains(scalar) {
                return String(scalar)
            }
            return " "
        }
        .joined()

        return sanitized
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    private static func normalizedMicrophoneDeviceID(_ deviceID: String?) -> String? {
        guard let trimmed = deviceID?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }

        return trimmed
    }

    private static func commonPCMFormat(for streamDescription: AudioStreamBasicDescription) -> AVAudioCommonFormat? {
        let isFloat = (streamDescription.mFormatFlags & kAudioFormatFlagIsFloat) != 0

        switch (isFloat, streamDescription.mBitsPerChannel) {
        case (true, 32):
            return .pcmFormatFloat32
        case (true, 64):
            return .pcmFormatFloat64
        case (false, 16):
            return .pcmFormatInt16
        case (false, 32):
            return .pcmFormatInt32
        default:
            return nil
        }
    }

    private static func isInterleavedPCM(_ streamDescription: AudioStreamBasicDescription) -> Bool {
        (streamDescription.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
    }

    private static func fourCharacterCode(_ formatID: AudioFormatID) -> String {
        let bigEndian = formatID.bigEndian
        let bytes = [
            UInt8((bigEndian >> 24) & 0xFF),
            UInt8((bigEndian >> 16) & 0xFF),
            UInt8((bigEndian >> 8) & 0xFF),
            UInt8(bigEndian & 0xFF)
        ]

        if bytes.allSatisfy({ $0 >= 32 && $0 <= 126 }) {
            return String(decoding: bytes, as: UTF8.self)
        }

        return String(format: "0x%08X", formatID)
    }

    private static func ensureMicrophoneAuthorization() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    continuation.resume(returning: granted)
                }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }

    private static func ensureSpeechAuthorization() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}