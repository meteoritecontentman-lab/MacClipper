import Foundation
@preconcurrency import AVFoundation
import ScreenCaptureKit
import CoreGraphics
import AppKit
import QuartzCore

enum CaptureResolutionPreset: String, CaseIterable, Codable, Identifiable {
    case automatic
    case p720
    case p1080
    case p1440
    case p2160

    var id: String { rawValue }

    static let highestFreePreset: CaptureResolutionPreset = .p1440

    var displayName: String {
        switch self {
        case .automatic: return "Automatic"
        case .p720: return "720p"
        case .p1080: return "1080p"
        case .p1440: return "1440p"
        case .p2160: return "4K Pro"
        }
    }

    var requires4KProUnlock: Bool {
        self == .p2160
    }

    var targetSize: CGSize? {
        switch self {
        case .automatic:
            return nil
        case .p720:
            return CGSize(width: 1280, height: 720)
        case .p1080:
            return CGSize(width: 1920, height: 1080)
        case .p1440:
            return CGSize(width: 2560, height: 1440)
        case .p2160:
            return CGSize(width: 3840, height: 2160)
        }
    }
}

enum VideoQualityPreset: String, CaseIterable, Codable, Identifiable {
    case performance
    case balanced
    case highest

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .performance: return "Performance"
        case .balanced: return "Balanced"
        case .highest: return "Highest"
        }
    }

    var preferredFramesPerSecond: Int32 {
        switch self {
        case .performance:
            return 30
        case .balanced, .highest:
            return 60
        }
    }

    var bitrateMultiplier: Double {
        switch self {
        case .performance:
            return 2.8
        case .balanced:
            return 4.2
        case .highest:
            return 6.2
        }
    }
}

struct RecorderSettings: Sendable {
    var clipDuration: TimeInterval
    var saveDirectory: URL
    var includeMicrophone: Bool
    var preferredMicrophoneDeviceID: String?
    var captureSystemAudio: Bool
    var systemAudioLevel: Double
    var microphoneAudioLevel: Double
    var showCursor: Bool
    var preferredDisplayID: UInt32?
    var resolutionPreset: CaptureResolutionPreset
    var videoQuality: VideoQualityPreset
}

private struct AudioTrackSlot: Hashable {
    let role: CapturedAudioTrackRole
    let ordinal: Int
}

private struct AudioTrackEntry {
    let slot: AudioTrackSlot
    let track: AVMutableCompositionTrack
}

enum RecorderError: LocalizedError {
    case screenPermissionDenied
    case microphonePermissionDenied
    case noDisplayAvailable
    case noBufferedClip
    case captureStalled(stalledSeconds: Int)
    case bufferNotReady(requestedSeconds: Int, availableSeconds: Int)
    case exportFailed(String)

    var errorDescription: String? {
        switch self {
        case .screenPermissionDenied:
            return "Screen recording permission was denied."
        case .microphonePermissionDenied:
            return "Microphone permission was denied."
        case .noDisplayAvailable:
            return "No display is available to capture."
        case .noBufferedClip:
            return "Capture is still warming up. Try again in a moment."
        case .captureStalled(let stalledSeconds):
            if stalledSeconds <= 0 {
                return "Capture feed stalled. Reconnecting capture…"
            }
            return "Capture feed stalled for \(stalledSeconds)s. Reconnecting capture…"
        case .bufferNotReady(let requestedSeconds, let availableSeconds):
            if availableSeconds <= 0 {
                return "Capture is still filling. Wait about \(requestedSeconds) seconds, then try again."
            }
            return "Only \(availableSeconds) of \(requestedSeconds) seconds are buffered so far. Wait a bit longer and try again."
        case .exportFailed(let message):
            return "Clip export failed: \(message)"
        }
    }
}

struct ReplayCapturePoint: Sendable {
    let requestedAt: Date
    let latestScreenPTS: CMTime?
}

private struct SegmentInfo: Sendable {
    let url: URL
    let startedAt: Date
    let endedAt: Date
    let startPTS: CMTime
    let endPTS: CMTime
    let duration: TimeInterval
}

private struct SegmentExportPlan: Sendable {
    let url: URL
    let localStart: TimeInterval
    let duration: TimeInterval
}

private struct PreparedSegment: Sendable {
    let url: URL
    let startedAt: Date
    let endedAt: Date
    let startPTS: CMTime
    let endPTS: CMTime
    let duration: TimeInterval
}

private struct ScreenSampleDescriptor: Equatable, Sendable {
    let width: Int
    let height: Int
    let mediaSubType: FourCharCode

    var displaySize: CGSize {
        CGSize(width: width, height: height)
    }

    var logDescription: String {
        let bigEndian = mediaSubType.bigEndian
        let bytes = [
            UInt8((bigEndian >> 24) & 0xFF),
            UInt8((bigEndian >> 16) & 0xFF),
            UInt8((bigEndian >> 8) & 0xFF),
            UInt8(bigEndian & 0xFF)
        ]
        let subtypeText = bytes.allSatisfy { $0 >= 32 && $0 <= 126 }
            ? String(decoding: bytes, as: UTF8.self)
            : String(format: "0x%08X", mediaSubType)
        return "\(width)x\(height) \(subtypeText)"
    }
}

private enum SampleAppendResult {
    case appended
    case dropped
    case resetNeeded(String)
}

private enum CapturedSampleOutputType {
    case screen
    case systemAudio
    case microphone
}

private final class SampleBufferEnvelope: @unchecked Sendable {
    let sampleBuffer: CMSampleBuffer

    init(_ sampleBuffer: CMSampleBuffer) {
        self.sampleBuffer = sampleBuffer
    }
}

private final class StreamOutputBridge: NSObject, SCStreamOutput {
    let sessionID: UUID
    let sampleHandlerQueue: DispatchQueue

    private weak var recorder: ReplayBufferRecorder?

    init(recorder: ReplayBufferRecorder, sessionID: UUID) {
        self.recorder = recorder
        self.sessionID = sessionID
        self.sampleHandlerQueue = DispatchQueue(
            label: "MacClipper.replay-buffer.sample-output.\(sessionID.uuidString)",
            qos: .userInitiated
        )
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        recorder?.handleStreamOutputSampleBuffer(
            sampleBuffer,
            outputType: outputType,
            from: stream,
            sessionID: sessionID
        )
    }
}

private final class AVCaptureOutputBridge: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    let sessionID: UUID
    let sampleHandlerQueue: DispatchQueue

    private weak var recorder: ReplayBufferRecorder?

    init(recorder: ReplayBufferRecorder, sessionID: UUID) {
        self.recorder = recorder
        self.sessionID = sessionID
        self.sampleHandlerQueue = DispatchQueue(
            label: "MacClipper.replay-buffer.avcapture-output.\(sessionID.uuidString)",
            qos: .userInitiated
        )
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let outputType: CapturedSampleOutputType
        switch output {
        case is AVCaptureVideoDataOutput:
            outputType = .screen
        case is AVCaptureAudioDataOutput:
            outputType = .microphone
        default:
            return
        }

        recorder?.handleAVFoundationOutputSampleBuffer(
            sampleBuffer,
            outputType: outputType,
            sessionID: sessionID
        )
    }
}

enum CaptureStartupMode: String {
    case primary
    case compatibility

    var logDescription: String {
        rawValue
    }
}

private enum CaptureBackend: String {
    case screenCaptureKit = "sckit"
    case avFoundation = "avfoundation"

    var logDescription: String {
        rawValue
    }
}

private struct StreamStartupPlan {
    let startupMode: CaptureStartupMode
    let backend: CaptureBackend
    let targetCaptureSize: CGSize
    let captureSystemAudio: Bool
    let includeMicrophone: Bool
    let framesPerSecond: Int32?
    let queueDepth: Int?
    let usesDisplayOnlyFilter: Bool
    let appliesExplicitDimensions: Bool
    let appliesExplicitPixelFormat: Bool
}

private struct RunningMicrophoneCaptureSession {
    let session: AVCaptureSession
    let sessionID: UUID
    let outputBridge: AVCaptureOutputBridge
    let observerTokens: [NSObjectProtocol]
}

final class ReplayBufferRecorder: NSObject, SCStreamDelegate, @unchecked Sendable {
    private let recorderQueue = DispatchQueue(label: "MacClipper.replay-buffer.queue")
    private let captureControlQueue = DispatchQueue(label: "MacClipper.replay-buffer.capture-control", qos: .userInitiated)
    private let bufferDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("MacClipperBuffer", isDirectory: true)
    private let segmentDuration: TimeInterval = 1
    private let clipCaptureGrace: TimeInterval = 0.15
    private let initialBufferWarmupTimeout: TimeInterval = 1.5
    private let initialScreenSampleTimeout: TimeInterval = 3
    private let minimumClipDuration: TimeInterval = 0.1
    private let staleCaptureTailGapThreshold: TimeInterval = 8
    private let safetyMargin: TimeInterval = 12
    private let exportTimeoutPadding: TimeInterval = 8
    private let maxInitialSampleCallbackLogs = 6
    private let maxInitialScreenDropLogs = 6

    var onUnexpectedStop: (@MainActor (Error) -> Void)?
    var onMicrophoneSampleBuffer: ((CMSampleBuffer) -> Void)?

    private var stream: SCStream?
    private var captureSession: AVCaptureSession?
    private var activeCaptureSessionID: UUID?
    private var auxiliaryMicrophoneCaptureSessionID: UUID?
    private var activeStreamSessionID: UUID?
    private var activeStreamOutputBridge: StreamOutputBridge?
    private var activeAVFoundationOutputBridge: AVCaptureOutputBridge?
    private var activeCaptureBackend: CaptureBackend = .screenCaptureKit
    private var activeCaptureStartupMode: CaptureStartupMode = .primary
    private var activeCaptureIncludesSystemAudio = false
    private var activeCaptureIncludesMicrophone = false
    private var captureSessionObserverTokens: [NSObjectProtocol] = []
    private var currentWriter: LiveSegmentWriter?
    private var segments: [SegmentInfo] = []
    private var pendingSegmentTasks: [UUID: Task<SegmentInfo?, Never>] = [:]
    private var recordingStartedAt: Date?
    private var displaySize = CGSize(width: 1280, height: 720)
    private var suppressUnexpectedStopCallback = false
    private var initialScreenSampleWatchdogTask: Task<Void, Never>?
    private var initialSampleCallbackLogCount = 0
    private var initialScreenDropLogCount = 0
    private var currentSettings = RecorderSettings(
        clipDuration: 30,
        saveDirectory: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Movies/MacClipper", isDirectory: true),
        includeMicrophone: true,
        preferredMicrophoneDeviceID: nil,
        captureSystemAudio: true,
        systemAudioLevel: 0.60,
        microphoneAudioLevel: 1.0,
        showCursor: true,
        preferredDisplayID: nil,
        resolutionPreset: .automatic,
        videoQuality: .balanced
    )

    func update(settings: RecorderSettings) {
        recorderQueue.sync {
            self.currentSettings = settings
        }
    }

    func makeCapturePoint() -> ReplayCapturePoint {
        recorderQueue.sync {
            let latestPTS = currentWriter?.latestPTS ?? segments.last?.endPTS
            return ReplayCapturePoint(requestedAt: Date(), latestScreenPTS: latestPTS)
        }
    }

    func start(
        with settings: RecorderSettings,
        preservingBuffer: Bool = false,
        startupMode: CaptureStartupMode = .primary
    ) async throws {
        log(
            "start requested preservingBuffer=\(preservingBuffer) clipDuration=\(Int(settings.clipDuration)) display=\(settings.preferredDisplayID.map(String.init) ?? "auto") microphone=\(settings.includeMicrophone ? (settings.preferredMicrophoneDeviceID ?? "system-default") : "off") mode=\(startupMode.logDescription)"
        )
        if recorderQueue.sync(execute: { self.stream != nil || self.captureSession != nil }) {
            await stop()
        }

        update(settings: settings)
        if preservingBuffer {
            await flushPendingSegments()
        }
        let shareableContent = try await loadShareableContentEnsuringPermissions(includeMicrophone: settings.includeMicrophone)
        try prepareDirectories(saveDirectory: settings.saveDirectory, resetBuffer: !preservingBuffer)

        guard let display = Self.preferredDisplay(from: shareableContent.displays, preferredDisplayID: settings.preferredDisplayID) else {
            throw RecorderError.noDisplayAvailable
        }

        let nativeCaptureSize = Self.nativeCaptureSize(for: display)
        let startupPlan = Self.makeStreamStartupPlan(
            nativeCaptureSize: nativeCaptureSize,
            settings: settings,
            startupMode: startupMode
        )

        switch startupPlan.backend {
        case .screenCaptureKit:
            try await startScreenCaptureKitCapture(
                display: display,
                startupPlan: startupPlan,
                settings: settings,
                preservingBuffer: preservingBuffer
            )

        case .avFoundation:
            try await startAVFoundationCapture(
                displayID: display.displayID,
                nativeCaptureSize: nativeCaptureSize,
                startupPlan: startupPlan,
                settings: settings,
                preservingBuffer: preservingBuffer
            )
        }
    }

    private func startScreenCaptureKitCapture(
        display: SCDisplay,
        startupPlan: StreamStartupPlan,
        settings: RecorderSettings,
        preservingBuffer: Bool
    ) async throws {
        let usesAuxiliaryMicrophoneCapture = startupPlan.includeMicrophone && !Self.supportsScreenCaptureKitMicrophoneCapture
        let filter = startupPlan.usesDisplayOnlyFilter
            ? SCContentFilter(display: display, excludingWindows: [])
            : SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let configuration = SCStreamConfiguration()
        let streamSessionID = UUID()
        let streamOutputBridge = StreamOutputBridge(recorder: self, sessionID: streamSessionID)
        let supportsScreenCaptureKitSystemAudio: Bool
        if #available(macOS 13.0, *) {
            supportsScreenCaptureKitSystemAudio = true
        } else {
            supportsScreenCaptureKitSystemAudio = false
        }
        let effectiveSystemAudioCapture = startupPlan.captureSystemAudio && supportsScreenCaptureKitSystemAudio

        if startupPlan.appliesExplicitDimensions {
            configuration.width = Int(startupPlan.targetCaptureSize.width.rounded())
            configuration.height = Int(startupPlan.targetCaptureSize.height.rounded())
        }

        if let framesPerSecond = startupPlan.framesPerSecond {
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: framesPerSecond)
        }

        if let queueDepth = startupPlan.queueDepth {
            configuration.queueDepth = queueDepth
        }

        if startupPlan.appliesExplicitPixelFormat {
            configuration.pixelFormat = kCVPixelFormatType_32BGRA
        }

        configuration.showsCursor = settings.showCursor
        if #available(macOS 13.0, *) {
            configuration.capturesAudio = effectiveSystemAudioCapture
        }
        if #available(macOS 15.0, *), startupPlan.includeMicrophone, !usesAuxiliaryMicrophoneCapture {
            configuration.captureMicrophone = true
            configuration.microphoneCaptureDeviceID = settings.preferredMicrophoneDeviceID
        }
        if #available(macOS 13.0, *) {
            configuration.excludesCurrentProcessAudio = false
        }

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(streamOutputBridge, type: .screen, sampleHandlerQueue: streamOutputBridge.sampleHandlerQueue)

        if #available(macOS 13.0, *), effectiveSystemAudioCapture {
            try stream.addStreamOutput(streamOutputBridge, type: .audio, sampleHandlerQueue: streamOutputBridge.sampleHandlerQueue)
        }

        if #available(macOS 15.0, *), startupPlan.includeMicrophone, !usesAuxiliaryMicrophoneCapture {
            try stream.addStreamOutput(streamOutputBridge, type: .microphone, sampleHandlerQueue: streamOutputBridge.sampleHandlerQueue)
        }

        recorderQueue.sync {
            self.activeCaptureSessionID = streamSessionID
            self.auxiliaryMicrophoneCaptureSessionID = nil
            self.activeStreamSessionID = streamSessionID
            self.activeStreamOutputBridge = streamOutputBridge
            self.activeAVFoundationOutputBridge = nil
            self.activeCaptureBackend = startupPlan.backend
            self.activeCaptureStartupMode = startupPlan.startupMode
            self.activeCaptureIncludesSystemAudio = effectiveSystemAudioCapture
            self.activeCaptureIncludesMicrophone = startupPlan.includeMicrophone
            self.captureSessionObserverTokens.removeAll()
            self.captureSession = nil
            self.stream = stream
            self.displaySize = startupPlan.targetCaptureSize
            self.currentWriter = nil
            if !preservingBuffer {
                self.segments.removeAll()
            }
            self.pendingSegmentTasks.removeAll()
            self.recordingStartedAt = Date()
            self.suppressUnexpectedStopCallback = false
            self.initialSampleCallbackLogCount = 0
            self.initialScreenDropLogCount = 0
            self.trimOldSegments(now: Date())
        }

        do {
            try await stream.startCapture()
        } catch {
            recorderQueue.sync {
                if self.activeStreamSessionID == streamSessionID,
                   let currentStream = self.stream,
                   ObjectIdentifier(currentStream) == ObjectIdentifier(stream) {
                    self.activeCaptureSessionID = nil
                    self.auxiliaryMicrophoneCaptureSessionID = nil
                    self.activeStreamSessionID = nil
                    self.activeStreamOutputBridge = nil
                    self.activeAVFoundationOutputBridge = nil
                    self.activeCaptureBackend = .screenCaptureKit
                    self.activeCaptureStartupMode = .primary
                    self.activeCaptureIncludesSystemAudio = false
                    self.activeCaptureIncludesMicrophone = false
                    self.captureSessionObserverTokens.removeAll()
                    self.captureSession = nil
                    self.stream = nil
                }
            }
            throw error
        }

        let auxiliaryMicrophoneCapture = usesAuxiliaryMicrophoneCapture
            ? await startAuxiliaryMicrophoneCaptureSession(settings: settings)
            : nil
        let microphoneEnabled = usesAuxiliaryMicrophoneCapture
            ? auxiliaryMicrophoneCapture != nil
            : startupPlan.includeMicrophone

        recorderQueue.sync {
            guard self.activeStreamSessionID == streamSessionID,
                  let currentStream = self.stream,
                  ObjectIdentifier(currentStream) == ObjectIdentifier(stream) else {
                return
            }

            self.auxiliaryMicrophoneCaptureSessionID = auxiliaryMicrophoneCapture?.sessionID
            self.activeAVFoundationOutputBridge = auxiliaryMicrophoneCapture?.outputBridge
            self.captureSessionObserverTokens = auxiliaryMicrophoneCapture?.observerTokens ?? []
            self.captureSession = auxiliaryMicrophoneCapture?.session
            self.activeCaptureIncludesMicrophone = microphoneEnabled
        }

        let filterDescription = startupPlan.usesDisplayOnlyFilter ? "display-only" : "standard"
        let framesPerSecondDescription = startupPlan.framesPerSecond.map(String.init) ?? "default"
        let queueDepthDescription = startupPlan.queueDepth.map(String.init) ?? "default"
        let audioDescription = startupPlan.captureSystemAudio ? "on" : "off"
        let microphoneDescription = microphoneEnabled ? "on" : "off"
        log(
            "capture started mode=\(startupPlan.startupMode.logDescription) backend=\(startupPlan.backend.logDescription) size=\(Int(startupPlan.targetCaptureSize.width))x\(Int(startupPlan.targetCaptureSize.height)) fps=\(framesPerSecondDescription) queueDepth=\(queueDepthDescription) audio=\(audioDescription) microphone=\(microphoneDescription) filter=\(filterDescription)"
        )

        recorderQueue.sync {
            self.scheduleInitialScreenSampleWatchdog(
                for: streamSessionID,
                settings: settings,
                preservingBuffer: preservingBuffer,
                startupMode: startupPlan.startupMode
            )
        }
    }

    private func startAuxiliaryMicrophoneCaptureSession(settings: RecorderSettings) async -> RunningMicrophoneCaptureSession? {
        guard let microphoneDevice = Self.preferredMicrophoneCaptureDevice(preferredUniqueID: settings.preferredMicrophoneDeviceID),
              let microphoneInput = try? AVCaptureDeviceInput(device: microphoneDevice) else {
            log("screen capture could not attach compatibility microphone input; continuing without microphone")
            return nil
        }

        let captureSession = AVCaptureSession()
        let captureSessionID = UUID()
        let outputBridge = AVCaptureOutputBridge(recorder: self, sessionID: captureSessionID)

        guard captureSession.canAddInput(microphoneInput) else {
            log("screen capture could not attach compatibility microphone input; continuing without microphone")
            return nil
        }
        captureSession.addInput(microphoneInput)

        let microphoneOutput = AVCaptureAudioDataOutput()
        microphoneOutput.setSampleBufferDelegate(outputBridge, queue: outputBridge.sampleHandlerQueue)
        guard captureSession.canAddOutput(microphoneOutput) else {
            captureSession.removeInput(microphoneInput)
            log("screen capture could not attach compatibility microphone output; continuing without microphone")
            return nil
        }
        captureSession.addOutput(microphoneOutput)

        let notificationCenter = NotificationCenter.default
        let runtimeErrorToken = notificationCenter.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification,
            object: captureSession,
            queue: nil
        ) { [weak self, weak captureSession] notification in
            guard let self, let captureSession else { return }
            let error = (notification.userInfo?[AVCaptureSessionErrorKey] as? NSError)
                ?? NSError(domain: "MacClipper.ReplayBufferRecorder", code: -3, userInfo: [NSLocalizedDescriptionKey: "Microphone capture session stopped."])
            self.handleAVFoundationSessionStopped(
                captureSession,
                sessionID: captureSessionID,
                error: error
            )
        }
        let didStopToken = notificationCenter.addObserver(
            forName: AVCaptureSession.didStopRunningNotification,
            object: captureSession,
            queue: nil
        ) { [weak self, weak captureSession] _ in
            guard let self, let captureSession else { return }
            let error = NSError(
                domain: "MacClipper.ReplayBufferRecorder",
                code: -4,
                userInfo: [NSLocalizedDescriptionKey: "Microphone capture session stopped running."]
            )
            self.handleAVFoundationSessionStopped(
                captureSession,
                sessionID: captureSessionID,
                error: error
            )
        }
        let observerTokens = [runtimeErrorToken, didStopToken]

        await withCheckedContinuation { continuation in
            captureControlQueue.async {
                captureSession.startRunning()
                continuation.resume()
            }
        }

        guard captureSession.isRunning else {
            observerTokens.forEach(notificationCenter.removeObserver)
            log("screen capture could not start compatibility microphone session; continuing without microphone")
            return nil
        }

        return RunningMicrophoneCaptureSession(
            session: captureSession,
            sessionID: captureSessionID,
            outputBridge: outputBridge,
            observerTokens: observerTokens
        )
    }

    private func startAVFoundationCapture(
        displayID: CGDirectDisplayID,
        nativeCaptureSize: CGSize,
        startupPlan: StreamStartupPlan,
        settings: RecorderSettings,
        preservingBuffer: Bool
    ) async throws {
        guard let screenInput = AVCaptureScreenInput(displayID: displayID) else {
            throw RecorderError.noDisplayAvailable
        }

        screenInput.capturesCursor = settings.showCursor
        if let framesPerSecond = startupPlan.framesPerSecond {
            screenInput.minFrameDuration = CMTime(value: 1, timescale: framesPerSecond)
        }
        screenInput.scaleFactor = Self.avFoundationScaleFactor(
            targetCaptureSize: startupPlan.targetCaptureSize,
            nativeCaptureSize: nativeCaptureSize
        )

        let captureSession = AVCaptureSession()
        let captureSessionID = UUID()
        let outputBridge = AVCaptureOutputBridge(recorder: self, sessionID: captureSessionID)
        let videoOutput = AVCaptureVideoDataOutput()
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
        ]
        videoOutput.setSampleBufferDelegate(outputBridge, queue: outputBridge.sampleHandlerQueue)

        guard captureSession.canAddInput(screenInput) else {
            throw RecorderError.exportFailed("Unable to attach the compatibility screen input.")
        }
        captureSession.addInput(screenInput)

        guard captureSession.canAddOutput(videoOutput) else {
            throw RecorderError.exportFailed("Unable to attach the compatibility screen output.")
        }
        captureSession.addOutput(videoOutput)

        var microphoneEnabled = false
        if startupPlan.includeMicrophone,
           let microphoneDevice = Self.preferredMicrophoneCaptureDevice(preferredUniqueID: settings.preferredMicrophoneDeviceID),
           let microphoneInput = try? AVCaptureDeviceInput(device: microphoneDevice),
           captureSession.canAddInput(microphoneInput) {
            captureSession.addInput(microphoneInput)

            let microphoneOutput = AVCaptureAudioDataOutput()
            microphoneOutput.setSampleBufferDelegate(outputBridge, queue: outputBridge.sampleHandlerQueue)
            if captureSession.canAddOutput(microphoneOutput) {
                captureSession.addOutput(microphoneOutput)
                microphoneEnabled = true
            } else {
                captureSession.removeInput(microphoneInput)
                log("compatibility capture could not attach microphone output; continuing without microphone")
            }
        } else if startupPlan.includeMicrophone {
            log("compatibility capture could not attach microphone input; continuing without microphone")
        }

        let notificationCenter = NotificationCenter.default
        let runtimeErrorToken = notificationCenter.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification,
            object: captureSession,
            queue: nil
        ) { [weak self, weak captureSession] notification in
            guard let self, let captureSession else { return }
            let error = (notification.userInfo?[AVCaptureSessionErrorKey] as? NSError)
                ?? NSError(domain: "MacClipper.ReplayBufferRecorder", code: -1, userInfo: [NSLocalizedDescriptionKey: "Compatibility capture session stopped."])
            self.handleAVFoundationSessionStopped(
                captureSession,
                sessionID: captureSessionID,
                error: error
            )
        }
        let didStopToken = notificationCenter.addObserver(
            forName: AVCaptureSession.didStopRunningNotification,
            object: captureSession,
            queue: nil
        ) { [weak self, weak captureSession] _ in
            guard let self, let captureSession else { return }
            let error = NSError(
                domain: "MacClipper.ReplayBufferRecorder",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "Compatibility capture session stopped running."]
            )
            self.handleAVFoundationSessionStopped(
                captureSession,
                sessionID: captureSessionID,
                error: error
            )
        }
        let observerTokens = [runtimeErrorToken, didStopToken]

        recorderQueue.sync {
            self.activeCaptureSessionID = captureSessionID
            self.auxiliaryMicrophoneCaptureSessionID = nil
            self.activeStreamSessionID = nil
            self.activeStreamOutputBridge = nil
            self.activeAVFoundationOutputBridge = outputBridge
            self.activeCaptureBackend = startupPlan.backend
            self.activeCaptureStartupMode = startupPlan.startupMode
            self.activeCaptureIncludesSystemAudio = false
            self.activeCaptureIncludesMicrophone = microphoneEnabled
            self.captureSessionObserverTokens = observerTokens
            self.captureSession = captureSession
            self.stream = nil
            self.displaySize = startupPlan.targetCaptureSize
            self.currentWriter = nil
            if !preservingBuffer {
                self.segments.removeAll()
            }
            self.pendingSegmentTasks.removeAll()
            self.recordingStartedAt = Date()
            self.suppressUnexpectedStopCallback = false
            self.initialSampleCallbackLogCount = 0
            self.initialScreenDropLogCount = 0
            self.trimOldSegments(now: Date())
        }

        await withCheckedContinuation { continuation in
            captureControlQueue.async {
                captureSession.startRunning()
                continuation.resume()
            }
        }

        guard captureSession.isRunning else {
            observerTokens.forEach(notificationCenter.removeObserver)
            recorderQueue.sync {
                if self.activeCaptureSessionID == captureSessionID,
                   let currentSession = self.captureSession,
                   currentSession == captureSession {
                    self.activeCaptureSessionID = nil
                    self.auxiliaryMicrophoneCaptureSessionID = nil
                    self.activeStreamSessionID = nil
                    self.activeStreamOutputBridge = nil
                    self.activeAVFoundationOutputBridge = nil
                    self.activeCaptureBackend = .screenCaptureKit
                    self.activeCaptureStartupMode = .primary
                    self.activeCaptureIncludesSystemAudio = false
                    self.activeCaptureIncludesMicrophone = false
                    self.captureSessionObserverTokens = []
                    self.captureSession = nil
                    self.stream = nil
                }
            }
            throw RecorderError.exportFailed("Compatibility capture session failed to start.")
        }

        let framesPerSecondDescription = startupPlan.framesPerSecond.map(String.init) ?? "default"
        let microphoneDescription = microphoneEnabled ? "on" : "off"
        log(
            "capture started mode=\(startupPlan.startupMode.logDescription) backend=\(startupPlan.backend.logDescription) size=\(Int(startupPlan.targetCaptureSize.width))x\(Int(startupPlan.targetCaptureSize.height)) fps=\(framesPerSecondDescription) queueDepth=default audio=off microphone=\(microphoneDescription) filter=n/a"
        )

        recorderQueue.sync {
            self.scheduleInitialScreenSampleWatchdog(
                for: captureSessionID,
                settings: settings,
                preservingBuffer: preservingBuffer,
                startupMode: startupPlan.startupMode
            )
        }
    }

    func stop() async {
        log("stop requested")
        let (stream, outputBridge, hasSystemAudioOutput, hasMicrophoneOutput, captureSession, avFoundationOutputBridge, observerTokens, watchdogTask) = recorderQueue.sync { () -> (SCStream?, StreamOutputBridge?, Bool, Bool, AVCaptureSession?, AVCaptureOutputBridge?, [NSObjectProtocol], Task<Void, Never>?) in
            self.suppressUnexpectedStopCallback = true
            let existingStream = self.stream
            let outputBridge = self.activeStreamOutputBridge
            let hasSystemAudioOutput = self.activeCaptureIncludesSystemAudio
            let hasMicrophoneOutput = self.activeCaptureIncludesMicrophone
            let existingCaptureSession = self.captureSession
            let avFoundationOutputBridge = self.activeAVFoundationOutputBridge
            let observerTokens = self.captureSessionObserverTokens
            self.activeCaptureSessionID = nil
            self.auxiliaryMicrophoneCaptureSessionID = nil
            self.activeStreamSessionID = nil
            self.activeStreamOutputBridge = nil
            self.activeAVFoundationOutputBridge = nil
            self.activeCaptureBackend = .screenCaptureKit
            self.activeCaptureStartupMode = .primary
            self.activeCaptureIncludesSystemAudio = false
            self.activeCaptureIncludesMicrophone = false
            self.captureSessionObserverTokens = []
            self.captureSession = nil
            self.stream = nil
            let watchdogTask = self.initialScreenSampleWatchdogTask
            self.initialScreenSampleWatchdogTask = nil
            return (existingStream, outputBridge, hasSystemAudioOutput, hasMicrophoneOutput, existingCaptureSession, avFoundationOutputBridge, observerTokens, watchdogTask)
        }
        watchdogTask?.cancel()

        if let stream, let outputBridge {
            try? stream.removeStreamOutput(outputBridge, type: .screen)
            if #available(macOS 13.0, *), hasSystemAudioOutput {
                try? stream.removeStreamOutput(outputBridge, type: .audio)
            }
            if #available(macOS 15.0, *), hasMicrophoneOutput {
                try? stream.removeStreamOutput(outputBridge, type: .microphone)
            }
        }

        if !observerTokens.isEmpty {
            let notificationCenter = NotificationCenter.default
            observerTokens.forEach(notificationCenter.removeObserver)
        }

        if let captureSession {
            await withCheckedContinuation { continuation in
                captureControlQueue.async {
                    if captureSession.isRunning {
                        captureSession.stopRunning()
                    }
                    continuation.resume()
                }
            }
        }

        try? await stream?.stopCapture()
        withExtendedLifetime(outputBridge) {}
        withExtendedLifetime(avFoundationOutputBridge) {}
        await flushPendingSegments()

        if let finalizedSegment = await finalizeCurrentWriter() {
            recorderQueue.sync {
                self.storeFinalizedSegment(finalizedSegment)
            }
        }

        await flushPendingSegments()

        recorderQueue.sync {
            self.currentWriter = nil
            self.segments.removeAll()
            self.pendingSegmentTasks.removeAll()
            self.recordingStartedAt = nil
            self.initialSampleCallbackLogCount = 0
            self.initialScreenDropLogCount = 0
        }

        try? FileManager.default.removeItem(at: bufferDirectory)
        log("capture stopped and buffer cleared")
    }

    func saveReplayClip(
        capturePoint: ReplayCapturePoint = ReplayCapturePoint(requestedAt: Date(), latestScreenPTS: nil),
        suppressMicrophoneInExport: Bool = false
    ) async throws -> URL {
        log("saveReplayClip requested latestPTS=\(capturePoint.latestScreenPTS?.seconds ?? -1)")
        let settings = recorderQueue.sync { currentSettings }

        if clipCaptureGrace > 0 {
            try? await Task.sleep(nanoseconds: UInt64(clipCaptureGrace * 1_000_000_000))
        }

        if capturePoint.latestScreenPTS == nil {
            log("saveReplayClip waiting for first buffered screen sample")
            await waitForInitialBufferWarmup(timeout: initialBufferWarmupTimeout)
        }

        await flushPendingSegments()

        if let finalizedSegment = await finalizeCurrentWriter() {
            recorderQueue.sync {
                self.storeFinalizedSegment(finalizedSegment)
            }
        }

        await flushPendingSegments()

        let snapshot = recorderQueue.sync {
            segments.sorted { $0.endedAt < $1.endedAt }
        }
        log("segment snapshot count=\(snapshot.count)")

        guard !snapshot.isEmpty else {
            log("saveReplayClip failed: no buffered segments")
            throw RecorderError.noBufferedClip
        }

        let preparedSegments = await prepareSegments(from: snapshot)
        guard !preparedSegments.isEmpty else {
            log("saveReplayClip failed: prepared segments empty")
            throw RecorderError.noBufferedClip
        }

        let requestedEndDate = capturePoint.requestedAt
        let latestPreparedEndDate = preparedSegments.last?.endedAt ?? requestedEndDate
        let exportEndDate = min(requestedEndDate, latestPreparedEndDate)
        let tailGap = max(0, requestedEndDate.timeIntervalSince(latestPreparedEndDate))

        let availableDuration = preparedSegments.reduce(into: 0.0) { runningTotal, segment in
            let segmentEndDate = min(segment.endedAt, exportEndDate)
            runningTotal += max(0, segmentEndDate.timeIntervalSince(segment.startedAt))
        }
        log("prepared segments count=\(preparedSegments.count) availableDuration=\(String(format: "%.2f", availableDuration))")
        if tailGap > 0.01 {
            log("clip request tail gap=\(String(format: "%.2f", tailGap)) seconds before the shortcut")
        }

        if tailGap >= staleCaptureTailGapThreshold,
           availableDuration < minimumClipDuration {
            log("saveReplayClip failed: capture appears stalled tailGap=\(String(format: "%.2f", tailGap))")
            throw RecorderError.captureStalled(stalledSeconds: Int(tailGap.rounded()))
        }

        guard availableDuration >= minimumClipDuration else {
            log("saveReplayClip failed: availableDuration below minimum")
            throw RecorderError.noBufferedClip
        }

        let effectiveClipDuration = min(settings.clipDuration, availableDuration)
        var exportPlan: [SegmentExportPlan] = []
        var remainingDuration = effectiveClipDuration
        var cursorEndDate = exportEndDate

        for segment in preparedSegments.reversed() {
            let segmentEndDate = min(segment.endedAt, cursorEndDate)
            let usableDuration = max(0, segmentEndDate.timeIntervalSince(segment.startedAt))
            guard usableDuration > 0.01 else { continue }

            let durationToTake = min(remainingDuration, usableDuration)
            let localEndOffset = max(0, segmentEndDate.timeIntervalSince(segment.startedAt))
            let localStart = max(0, localEndOffset - durationToTake)
            exportPlan.append(
                SegmentExportPlan(
                    url: segment.url,
                    localStart: localStart,
                    duration: durationToTake
                )
            )

            remainingDuration -= durationToTake
            cursorEndDate = min(cursorEndDate, segment.startedAt)
            if remainingDuration <= 0.01 {
                break
            }
        }

        guard !exportPlan.isEmpty else {
            log("saveReplayClip failed: export plan empty")
            throw RecorderError.noBufferedClip
        }

        let outputURL = try await exportClip(
            from: exportPlan.reversed(),
            targetDuration: effectiveClipDuration,
            videoQuality: settings.videoQuality,
            saveDirectory: settings.saveDirectory,
            captureSystemAudio: settings.captureSystemAudio,
            includeMicrophoneInExport: settings.includeMicrophone && !suppressMicrophoneInExport,
            systemAudioLevel: settings.systemAudioLevel,
            microphoneAudioLevel: settings.microphoneAudioLevel
        )
        log("saveReplayClip completed output=\(outputURL.lastPathComponent)")
        return outputURL
    }

    private func waitForInitialBufferWarmup(timeout: TimeInterval) async {
        guard timeout > 0 else { return }

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let hasBufferedScreenSample = recorderQueue.sync {
                if !segments.isEmpty {
                    return true
                }

                return currentWriter?.latestPTS != nil
            }

            if hasBufferedScreenSample {
                return
            }

            try? await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    fileprivate func handleStreamOutputSampleBuffer(
        _ sampleBuffer: CMSampleBuffer,
        outputType: SCStreamOutputType,
        from stream: SCStream,
        sessionID: UUID
    ) {
        let streamID = ObjectIdentifier(stream)
        let sampleBufferEnvelope = SampleBufferEnvelope(sampleBuffer)
        recorderQueue.async {
            guard self.activeStreamSessionID == sessionID else {
                return
            }

            guard let currentStream = self.stream,
                  ObjectIdentifier(currentStream) == streamID else {
                return
            }

            let sampleBuffer = sampleBufferEnvelope.sampleBuffer
            guard let capturedOutputType = Self.capturedSampleOutputType(from: outputType) else {
                return
            }

            self.logInitialSampleCallback(outputType: capturedOutputType, sampleBuffer: sampleBuffer)

            if !CMSampleBufferDataIsReady(sampleBuffer) {
                guard capturedOutputType == .screen,
                      CMSampleBufferGetImageBuffer(sampleBuffer) != nil else {
                    if capturedOutputType == .screen {
                        self.logInitialScreenSampleDrop("screen sample dropped before handleSampleBuffer: data not ready", sampleBuffer: sampleBuffer)
                    }
                    return
                }
            }

            self.handleSampleBuffer(sampleBuffer, outputType: capturedOutputType)
        }
    }

    fileprivate func handleAVFoundationOutputSampleBuffer(
        _ sampleBuffer: CMSampleBuffer,
        outputType: CapturedSampleOutputType,
        sessionID: UUID
    ) {
        let sampleBufferEnvelope = SampleBufferEnvelope(sampleBuffer)
        recorderQueue.async {
            let isPrimaryAVFoundationCapture = self.activeCaptureBackend == .avFoundation
                && self.activeCaptureSessionID == sessionID
            let isAuxiliaryMicrophoneCapture = self.activeCaptureBackend == .screenCaptureKit
                && outputType == .microphone
                && self.auxiliaryMicrophoneCaptureSessionID == sessionID

            guard (isPrimaryAVFoundationCapture || isAuxiliaryMicrophoneCapture),
                  self.captureSession != nil else {
                return
            }

            let sampleBuffer = sampleBufferEnvelope.sampleBuffer

            self.logInitialSampleCallback(outputType: outputType, sampleBuffer: sampleBuffer)

            if !CMSampleBufferDataIsReady(sampleBuffer) {
                guard outputType == .screen,
                      CMSampleBufferGetImageBuffer(sampleBuffer) != nil else {
                    if outputType == .screen {
                        self.logInitialScreenSampleDrop("screen sample dropped before handleSampleBuffer: data not ready", sampleBuffer: sampleBuffer)
                    }
                    return
                }
            }

            self.handleSampleBuffer(sampleBuffer, outputType: outputType)
        }
    }

    private func handleAVFoundationSessionStopped(
        _ captureSession: AVCaptureSession,
        sessionID: UUID,
        error: Error
    ) {
        log("capture stopped unexpectedly backend=avfoundation message=\(error.localizedDescription)")

        let cleanup = recorderQueue.sync { () -> (Bool, SCStream?, [NSObjectProtocol])? in
            let isPrimaryAVFoundationCapture = self.activeCaptureBackend == .avFoundation
                && self.activeCaptureSessionID == sessionID
            let isAuxiliaryMicrophoneCapture = self.activeCaptureBackend == .screenCaptureKit
                && self.auxiliaryMicrophoneCaptureSessionID == sessionID

            guard (isPrimaryAVFoundationCapture || isAuxiliaryMicrophoneCapture),
                  let currentCaptureSession = self.captureSession,
                  currentCaptureSession == captureSession else {
                return nil
            }

            let shouldNotify = !self.suppressUnexpectedStopCallback
            let writerToFinalize = self.currentWriter
            let currentStream = self.stream
            let observerTokens = self.captureSessionObserverTokens
            self.initialScreenSampleWatchdogTask?.cancel()
            self.initialScreenSampleWatchdogTask = nil
            self.suppressUnexpectedStopCallback = true

            self.activeCaptureSessionID = nil
            self.auxiliaryMicrophoneCaptureSessionID = nil
            self.activeStreamSessionID = nil
            self.activeStreamOutputBridge = nil
            self.activeAVFoundationOutputBridge = nil
            self.activeCaptureBackend = .screenCaptureKit
            self.activeCaptureStartupMode = .primary
            self.activeCaptureIncludesSystemAudio = false
            self.activeCaptureIncludesMicrophone = false
            self.captureSessionObserverTokens = []
            self.captureSession = nil
            self.stream = nil
            self.currentWriter = nil
            self.recordingStartedAt = nil
            if let writerToFinalize {
                self.enqueuePendingSegmentFinalization(for: writerToFinalize)
            }
            self.trimOldSegments(now: Date())

            return (shouldNotify, currentStream, observerTokens)
        }

        guard let cleanup else { return }

        if !cleanup.2.isEmpty {
            let notificationCenter = NotificationCenter.default
            cleanup.2.forEach(notificationCenter.removeObserver)
        }

        Task { [weak self] in
            if let stream = cleanup.1 {
                try? await stream.stopCapture()
            }

            guard cleanup.0 else { return }

            await MainActor.run {
                self?.onUnexpectedStop?(error)
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("stream stopped unexpectedly: \(error.localizedDescription)")
        let stoppedStreamID = ObjectIdentifier(stream)

        let cleanup = recorderQueue.sync { () -> (Bool, AVCaptureSession?, [NSObjectProtocol])? in
            guard let currentStream = self.stream,
                  ObjectIdentifier(currentStream) == stoppedStreamID else {
                return nil
            }

            let shouldNotify = !self.suppressUnexpectedStopCallback
            let writerToFinalize = self.currentWriter
            let currentCaptureSession = self.captureSession
            let observerTokens = self.captureSessionObserverTokens
            self.initialScreenSampleWatchdogTask?.cancel()
            self.initialScreenSampleWatchdogTask = nil
            self.suppressUnexpectedStopCallback = true

            self.activeCaptureSessionID = nil
            self.auxiliaryMicrophoneCaptureSessionID = nil
            self.activeStreamSessionID = nil
            self.activeStreamOutputBridge = nil
            self.activeAVFoundationOutputBridge = nil
            self.activeCaptureBackend = .screenCaptureKit
            self.activeCaptureStartupMode = .primary
            self.activeCaptureIncludesSystemAudio = false
            self.activeCaptureIncludesMicrophone = false
            self.captureSessionObserverTokens = []
            self.captureSession = nil
            self.stream = nil

            self.currentWriter = nil
            self.recordingStartedAt = nil
            if let writerToFinalize {
                self.enqueuePendingSegmentFinalization(for: writerToFinalize)
            }
            self.trimOldSegments(now: Date())

            return (shouldNotify, currentCaptureSession, observerTokens)
        }

        guard let cleanup else { return }

        if !cleanup.2.isEmpty {
            let notificationCenter = NotificationCenter.default
            cleanup.2.forEach(notificationCenter.removeObserver)
        }

        Task { [weak self] in
            if let captureSession = cleanup.1 {
                await withCheckedContinuation { continuation in
                    self?.captureControlQueue.async {
                        if captureSession.isRunning {
                            captureSession.stopRunning()
                        }
                        continuation.resume()
                    } ?? continuation.resume()
                }
            }

            guard cleanup.0 else { return }

            await MainActor.run {
                self?.onUnexpectedStop?(error)
            }
        }
    }

    private func handleSampleBuffer(_ sampleBuffer: CMSampleBuffer, outputType: CapturedSampleOutputType) {
        let settings = currentSettings
        let captureSystemAudio = activeCaptureIncludesSystemAudio
        let includeMicrophone = activeCaptureIncludesMicrophone
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let screenDescriptor = outputType == .screen ? Self.screenSampleDescriptor(from: sampleBuffer) : nil
        let sampleDisplaySize = outputType == .screen
            ? (Self.screenDisplaySize(from: sampleBuffer) ?? displaySize)
            : displaySize

        if outputType == .systemAudio && !captureSystemAudio { return }
        if outputType == .microphone && !includeMicrophone { return }

        if outputType == .screen,
           !Self.isRecordableScreenSample(sampleBuffer) {
            logInitialScreenSampleDrop("screen sample rejected by recordable filter", sampleBuffer: sampleBuffer)
            return
        }

        if outputType == .microphone {
            onMicrophoneSampleBuffer?(sampleBuffer)
        }

        if outputType == .screen,
           displaySize != sampleDisplaySize {
            displaySize = sampleDisplaySize
            log("screen sample size updated size=\(Int(sampleDisplaySize.width))x\(Int(sampleDisplaySize.height))")
        }

        if outputType == .screen,
           let currentWriter,
           let screenDescriptor,
           !currentWriter.matchesScreenSample(screenDescriptor, displaySize: sampleDisplaySize) {
            log("screen format changed from \(currentWriter.screenDescriptorLogDescription) to \(screenDescriptor.logDescription); rotating writer")
            enqueuePendingSegmentFinalization(for: currentWriter)
            self.currentWriter = nil
        }

        if currentWriter == nil {
            guard outputType == .screen else { return }
            currentWriter = Self.makeWriter(
                in: bufferDirectory,
                displaySize: sampleDisplaySize,
                includeMicrophone: includeMicrophone,
                captureSystemAudio: captureSystemAudio,
                videoQuality: settings.videoQuality,
                screenFormatHint: Self.screenFormatDescription(from: sampleBuffer),
                screenSampleDescriptor: screenDescriptor
            )
        } else if outputType == .screen,
                  currentWriter?.shouldRotate(at: timestamp, segmentDuration: segmentDuration) == true {
            if let writerToFinish = currentWriter {
                enqueuePendingSegmentFinalization(for: writerToFinish)
            }

            currentWriter = Self.makeWriter(
                in: bufferDirectory,
                displaySize: sampleDisplaySize,
                includeMicrophone: includeMicrophone,
                captureSystemAudio: captureSystemAudio,
                videoQuality: settings.videoQuality,
                screenFormatHint: Self.screenFormatDescription(from: sampleBuffer),
                screenSampleDescriptor: screenDescriptor
            )
        }

        let appendResult = currentWriter?.append(sampleBuffer, as: outputType) ?? .dropped

        switch appendResult {
        case .appended:
            if outputType == .screen {
                noteInitialScreenSampleBuffered()
            }
            break
        case .dropped:
            return
        case .resetNeeded(let reason):
            log("writer reset needed outputType=\(Self.outputTypeDescription(outputType)) reason=\(reason)")
            currentWriter?.cancelAndDiscard()
            currentWriter = nil

            guard outputType == .screen else { return }

            currentWriter = Self.makeWriter(
                in: bufferDirectory,
                displaySize: sampleDisplaySize,
                includeMicrophone: includeMicrophone,
                captureSystemAudio: captureSystemAudio,
                videoQuality: settings.videoQuality,
                screenFormatHint: Self.screenFormatDescription(from: sampleBuffer),
                screenSampleDescriptor: screenDescriptor
            )

            let retryResult = currentWriter?.append(sampleBuffer, as: outputType) ?? .dropped
            switch retryResult {
            case .appended:
                log("writer recovered after retry")
            case .dropped:
                log("writer retry dropped first screen sample")
                return
            case .resetNeeded(let retryReason):
                log("writer retry failed reason=\(retryReason)")
                currentWriter?.cancelAndDiscard()
                currentWriter = nil
                return
            }
        }

        trimOldSegments(now: Date())
    }

    private func scheduleInitialScreenSampleWatchdog(
        for sessionID: UUID,
        settings: RecorderSettings,
        preservingBuffer: Bool,
        startupMode: CaptureStartupMode
    ) {
        initialScreenSampleWatchdogTask?.cancel()

        initialScreenSampleWatchdogTask = Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }

            try? await Task.sleep(nanoseconds: UInt64(self.initialScreenSampleTimeout * 1_000_000_000))
            guard !Task.isCancelled else { return }

            let shouldRestart = self.recorderQueue.sync {
                guard self.activeCaptureSessionID == sessionID,
                      self.activeCaptureStartupMode == startupMode else {
                    return false
                }

                let hasBufferedScreenSample = self.currentWriter?.latestPTS != nil || !self.segments.isEmpty
                guard !hasBufferedScreenSample else {
                    self.initialScreenSampleWatchdogTask = nil
                    return false
                }

                self.initialScreenSampleWatchdogTask = nil
                return true
            }

            guard shouldRestart else { return }

            switch startupMode {
            case .primary:
                self.log(
                    "initial screen sample missing after \(String(format: "%.1f", self.initialScreenSampleTimeout))s in primary mode; switching to compatibility capture mode"
                )

                do {
                    try await self.start(
                        with: settings,
                        preservingBuffer: preservingBuffer,
                        startupMode: .compatibility
                    )
                } catch {
                    self.log("compatibility capture fallback failed: \(error.localizedDescription)")
                }

            case .compatibility:
                self.log(
                    "initial screen sample still missing after \(String(format: "%.1f", self.initialScreenSampleTimeout))s in compatibility mode; leaving capture armed without further restart churn"
                )
            }
        }
    }

    private static func makeStreamStartupPlan(
        nativeCaptureSize: CGSize,
        settings: RecorderSettings,
        startupMode: CaptureStartupMode
    ) -> StreamStartupPlan {
        switch startupMode {
        case .primary:
            return StreamStartupPlan(
                startupMode: .primary,
                backend: .screenCaptureKit,
                targetCaptureSize: captureSize(for: nativeCaptureSize, preset: settings.resolutionPreset),
                captureSystemAudio: settings.captureSystemAudio,
                includeMicrophone: settings.includeMicrophone,
                framesPerSecond: settings.videoQuality.preferredFramesPerSecond,
                queueDepth: settings.videoQuality == .performance ? 6 : 8,
                usesDisplayOnlyFilter: false,
                appliesExplicitDimensions: true,
                appliesExplicitPixelFormat: true
            )

        case .compatibility:
            return StreamStartupPlan(
                startupMode: .compatibility,
                backend: .avFoundation,
                targetCaptureSize: captureSize(for: nativeCaptureSize, preset: settings.resolutionPreset),
                captureSystemAudio: false,
                includeMicrophone: settings.includeMicrophone,
                framesPerSecond: settings.videoQuality.preferredFramesPerSecond,
                queueDepth: nil,
                usesDisplayOnlyFilter: false,
                appliesExplicitDimensions: false,
                appliesExplicitPixelFormat: false
            )
        }
    }

    private static var supportsScreenCaptureKitMicrophoneCapture: Bool {
        if #available(macOS 15.0, *) {
            return true
        }

        return false
    }

    private func noteInitialScreenSampleBuffered() {
        initialScreenSampleWatchdogTask?.cancel()
        initialScreenSampleWatchdogTask = nil
        initialSampleCallbackLogCount = 0
        initialScreenDropLogCount = 0
    }

    private func logInitialSampleCallback(outputType: CapturedSampleOutputType, sampleBuffer: CMSampleBuffer) {
        guard currentWriter?.latestPTS == nil,
              segments.isEmpty,
              initialSampleCallbackLogCount < maxInitialSampleCallbackLogs else {
            return
        }

        initialSampleCallbackLogCount += 1
        let hasImageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) != nil
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        log(
            "received initial sample callback type=\(Self.outputTypeDescription(outputType)) pts=\(String(format: "%.3f", presentationTime)) dataReady=\(CMSampleBufferDataIsReady(sampleBuffer)) imageBuffer=\(hasImageBuffer)"
        )
    }

    private func logInitialScreenSampleDrop(_ reason: String, sampleBuffer: CMSampleBuffer) {
        guard currentWriter?.latestPTS == nil,
              segments.isEmpty,
              initialScreenDropLogCount < maxInitialScreenDropLogs else {
            return
        }

        initialScreenDropLogCount += 1
        let hasImageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) != nil
        let statusDescription = Self.screenFrameStatus(from: sampleBuffer)
            .map { String(describing: $0) }
            ?? "nil"
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds

        log(
            "\(reason) pts=\(String(format: "%.3f", presentationTime)) dataReady=\(CMSampleBufferDataIsReady(sampleBuffer)) imageBuffer=\(hasImageBuffer) status=\(statusDescription)"
        )
    }

    private static func outputTypeDescription(_ outputType: CapturedSampleOutputType) -> String {
        switch outputType {
        case .screen:
            return "screen"
        case .systemAudio:
            return "audio"
        case .microphone:
            return "microphone"
        }
    }

    private static func capturedSampleOutputType(from outputType: SCStreamOutputType) -> CapturedSampleOutputType? {
        if outputType == .screen {
            return .screen
        }

        if #available(macOS 13.0, *), outputType == .audio {
            return .systemAudio
        }

        if #available(macOS 15.0, *), outputType == .microphone {
            return .microphone
        }

        return nil
    }

    private func enqueuePendingSegmentFinalization(for writer: LiveSegmentWriter) {
        let taskID = UUID()
        let task = Task.detached(priority: .utility) { await writer.finish() }
        pendingSegmentTasks[taskID] = task

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            let finalizedSegment = await task.value

            self.recorderQueue.async {
                guard self.pendingSegmentTasks.removeValue(forKey: taskID) != nil else { return }
                guard let finalizedSegment else { return }
                self.storeFinalizedSegment(finalizedSegment)
            }
        }
    }

    private func flushPendingSegments() async {
        let pendingTasks = recorderQueue.sync { pendingSegmentTasks }

        for (taskID, task) in pendingTasks {
            let finalizedSegment = await task.value

            recorderQueue.sync {
                guard self.pendingSegmentTasks.removeValue(forKey: taskID) != nil else { return }
                guard let finalizedSegment else { return }
                self.storeFinalizedSegment(finalizedSegment)
            }
        }
    }

    private func finalizeCurrentWriter() async -> SegmentInfo? {
        let writer = recorderQueue.sync { () -> LiveSegmentWriter? in
            let existingWriter = self.currentWriter
            self.currentWriter = nil
            return existingWriter
        }

        return await writer?.finish()
    }

    private func storeFinalizedSegment(_ segment: SegmentInfo) {
        segments.append(segment)
        segments.sort { $0.endedAt < $1.endedAt }
        trimOldSegments(now: Date())
    }

    private func trimOldSegments(now currentTime: Date) {
        let keepDuration = currentSettings.clipDuration + safetyMargin
        let cutoffDate = currentTime.addingTimeInterval(-keepDuration)

        let expiredSegments = segments.filter { $0.endedAt < cutoffDate }
        segments.removeAll { $0.endedAt < cutoffDate }

        for segment in expiredSegments {
            try? FileManager.default.removeItem(at: segment.url)
        }
    }

    private func prepareDirectories(saveDirectory: URL, resetBuffer: Bool) throws {
        let fileManager = FileManager.default
        if resetBuffer {
            try? fileManager.removeItem(at: bufferDirectory)
        }
        try fileManager.createDirectory(at: bufferDirectory, withIntermediateDirectories: true)
        try ClipStorageManager.ensureRootDirectory(at: saveDirectory, fileManager: fileManager)
    }

    private func loadShareableContentEnsuringPermissions(includeMicrophone: Bool) async throws -> SCShareableContent {
        let screenAllowed = await MainActor.run {
            CGPreflightScreenCaptureAccess()
        }

        let shareableContent: SCShareableContent
        do {
            shareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        } catch {
            if screenAllowed {
                throw error
            }
            throw RecorderError.screenPermissionDenied
        }

        log("shareable content resolved displays=\(shareableContent.displays.count) windows=\(shareableContent.windows.count)")

        if !screenAllowed && shareableContent.displays.isEmpty {
            throw RecorderError.screenPermissionDenied
        }

        if includeMicrophone {
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized:
                break
            case .notDetermined, .denied, .restricted:
                throw RecorderError.microphonePermissionDenied
            @unknown default:
                throw RecorderError.microphonePermissionDenied
            }
        }

        return shareableContent
    }

    private static func nativeCaptureSize(for display: SCDisplay) -> CGSize {
        if let mode = CGDisplayCopyDisplayMode(display.displayID) {
            return CGSize(width: mode.pixelWidth, height: mode.pixelHeight)
        }

        return CGSize(width: display.width, height: display.height)
    }

    private static func preferredDisplay(from displays: [SCDisplay], preferredDisplayID: UInt32?) -> SCDisplay? {
        guard !displays.isEmpty else { return nil }

        if let preferredDisplayID,
           let preferredDisplay = displays.first(where: { $0.displayID == preferredDisplayID }) {
            return preferredDisplay
        }

        let mouseLocation = NSEvent.mouseLocation
        for screen in NSScreen.screens where screen.frame.contains(mouseLocation) {
            if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
               let matchedDisplay = displays.first(where: { $0.displayID == CGDirectDisplayID(number.uint32Value) }) {
                return matchedDisplay
            }
        }

        let mainDisplayID = CGMainDisplayID()
        if let mainDisplay = displays.first(where: { $0.displayID == mainDisplayID }) {
            return mainDisplay
        }

        return displays.first
    }

    private static func captureSize(for nativeSize: CGSize, preset: CaptureResolutionPreset) -> CGSize {
        guard let targetSize = preset.targetSize else { return nativeSize }

        let aspectRatio = nativeSize.width / max(nativeSize.height, 1)
        let maxWidth = min(nativeSize.width, targetSize.width)
        let maxHeight = min(nativeSize.height, targetSize.height)

        let widthLimitedHeight = maxWidth / aspectRatio
        if widthLimitedHeight <= maxHeight {
            return CGSize(width: roundedEven(maxWidth), height: roundedEven(widthLimitedHeight))
        }

        let heightLimitedWidth = maxHeight * aspectRatio
        return CGSize(width: roundedEven(heightLimitedWidth), height: roundedEven(maxHeight))
    }

    private static func avFoundationScaleFactor(targetCaptureSize: CGSize, nativeCaptureSize: CGSize) -> CGFloat {
        guard nativeCaptureSize.width > 0, nativeCaptureSize.height > 0 else {
            return 1.0
        }

        let widthScale = targetCaptureSize.width / nativeCaptureSize.width
        let heightScale = targetCaptureSize.height / nativeCaptureSize.height
        let clampedScale = min(1.0, max(0.1, min(widthScale, heightScale)))
        return CGFloat(clampedScale)
    }

    private static func preferredMicrophoneCaptureDevice(preferredUniqueID: String?) -> AVCaptureDevice? {
        AudioCaptureDeviceCatalog.preferredDevice(preferredUniqueID: preferredUniqueID)
    }

    private static func roundedEven(_ value: CGFloat) -> CGFloat {
        let roundedValue = max(2, Int(value.rounded()))
        return CGFloat(roundedValue.isMultiple(of: 2) ? roundedValue : roundedValue - 1)
    }

    private static func makeUniqueOutputURL(in saveDirectory: URL, exportedAt: Date) -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd 'at' h.mm.ss a"

        let baseName = "Clipped with MacClipper \(formatter.string(from: exportedAt))"
        var candidateURL = saveDirectory.appendingPathComponent(baseName).appendingPathExtension("mov")
        var suffix = 2

        while FileManager.default.fileExists(atPath: candidateURL.path) {
            candidateURL = saveDirectory
                .appendingPathComponent("\(baseName) \(suffix)")
                .appendingPathExtension("mov")
            suffix += 1
        }

        return candidateURL
    }

    private static func makeWriter(
        in directory: URL,
        displaySize: CGSize,
        includeMicrophone: Bool,
        captureSystemAudio: Bool,
        videoQuality: VideoQualityPreset,
        screenFormatHint: CMFormatDescription?,
        screenSampleDescriptor: ScreenSampleDescriptor?
    ) -> LiveSegmentWriter {
        let fileURL = directory.appendingPathComponent("segment-\(UUID().uuidString).mov")
        return LiveSegmentWriter(
            url: fileURL,
            displaySize: displaySize,
            includeMicrophone: includeMicrophone,
            captureSystemAudio: captureSystemAudio,
            videoQuality: videoQuality,
            screenFormatHint: screenFormatHint,
            screenSampleDescriptor: screenSampleDescriptor
        )
    }

    private static func screenFormatDescription(from sampleBuffer: CMSampleBuffer) -> CMFormatDescription? {
        CMSampleBufferGetFormatDescription(sampleBuffer)
    }

    private static func screenSampleDescriptor(from sampleBuffer: CMSampleBuffer) -> ScreenSampleDescriptor? {
        guard let formatDescription = screenFormatDescription(from: sampleBuffer) else {
            return nil
        }

        let dimensions = CMVideoFormatDescriptionGetDimensions(formatDescription)
        guard dimensions.width > 0, dimensions.height > 0 else {
            return nil
        }

        return ScreenSampleDescriptor(
            width: Int(dimensions.width),
            height: Int(dimensions.height),
            mediaSubType: CMFormatDescriptionGetMediaSubType(formatDescription)
        )
    }

    private static func screenDisplaySize(from sampleBuffer: CMSampleBuffer) -> CGSize? {
        if let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
            let width = CVPixelBufferGetWidth(imageBuffer)
            let height = CVPixelBufferGetHeight(imageBuffer)
            guard width > 0, height > 0 else { return nil }
            return CGSize(width: width, height: height)
        }

        return screenSampleDescriptor(from: sampleBuffer)?.displaySize
    }

    private static func screenFrameStatus(from sampleBuffer: CMSampleBuffer) -> SCFrameStatus? {
        guard let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let attachments = attachmentsArray.first,
              let rawValue = attachments[.status] as? Int else {
            return nil
        }

        return SCFrameStatus(rawValue: rawValue)
    }

    private static func isRecordableScreenSample(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard CMSampleBufferGetImageBuffer(sampleBuffer) != nil else { return false }

        if let status = screenFrameStatus(from: sampleBuffer) {
            switch status {
            case .complete, .idle, .started:
                return true
            case .blank, .suspended, .stopped:
                return false
            @unknown default:
                return true
            }
        }

        return true
    }

    private func prepareSegments(from snapshot: [SegmentInfo]) async -> [PreparedSegment] {
        var preparedSegments: [PreparedSegment] = []
        preparedSegments.reserveCapacity(snapshot.count)

        for segment in snapshot {
            let asset = AVURLAsset(url: segment.url)
            let assetDuration = asset.duration.seconds
            let fallbackDuration = max(segment.duration, segment.endedAt.timeIntervalSince(segment.startedAt))
            let resolvedDuration: TimeInterval
            if fallbackDuration > 0.01 {
                resolvedDuration = fallbackDuration
            } else if assetDuration.isFinite {
                resolvedDuration = max(0, assetDuration)
            } else {
                resolvedDuration = 0
            }
            let resolvedEnd = segment.endPTS
            let resolvedStart = CMTimeMaximum(.zero, CMTimeSubtract(resolvedEnd, CMTime(seconds: resolvedDuration, preferredTimescale: 600)))
            let resolvedEndDate = segment.endedAt
            let resolvedStartDate = resolvedEndDate.addingTimeInterval(-resolvedDuration)

            preparedSegments.append(
                PreparedSegment(
                    url: segment.url,
                    startedAt: resolvedStartDate,
                    endedAt: resolvedEndDate,
                    startPTS: resolvedStart,
                    endPTS: resolvedEnd,
                    duration: resolvedDuration
                )
            )
        }

        return preparedSegments.sorted { $0.endedAt < $1.endedAt }
    }

    private func exportClip(
        from segments: [SegmentExportPlan],
        targetDuration: TimeInterval,
        videoQuality: VideoQualityPreset,
        saveDirectory: URL,
        captureSystemAudio: Bool,
        includeMicrophoneInExport: Bool,
        systemAudioLevel: Double,
        microphoneAudioLevel: Double
    ) async throws -> URL {
        let composition = AVMutableComposition()
        guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RecorderError.exportFailed("Unable to create the output video track.")
        }

        var audioTracksBySlot: [AudioTrackSlot: AVMutableCompositionTrack] = [:]
        var audioTrackEntries: [AudioTrackEntry] = []
        var insertTime: CMTime = .zero

        for segment in segments {
            guard segment.duration > 0 else { continue }

            let localStart = CMTime(seconds: segment.localStart, preferredTimescale: 600)
            let duration = CMTime(seconds: segment.duration, preferredTimescale: 600)
            let timeRange = CMTimeRange(start: localStart, duration: duration)
            let asset = AVURLAsset(url: segment.url)

            if let sourceVideo = asset.tracks(withMediaType: .video).first {
                try videoTrack.insertTimeRange(timeRange, of: sourceVideo, at: insertTime)
                if videoTrack.preferredTransform == .identity {
                    videoTrack.preferredTransform = sourceVideo.preferredTransform
                }
            }

            let sourceAudioTracks = asset.tracks(withMediaType: .audio)
            let hasMultipleAudioTracks = sourceAudioTracks.count > 1
            var includedAudioTrackOrdinal = 0

            for sourceAudioTrack in sourceAudioTracks {
                let audioTrackRole = Self.resolvedAudioTrackRole(
                    for: sourceAudioTrack,
                    captureSystemAudio: captureSystemAudio,
                    includeMicrophoneInExport: includeMicrophoneInExport,
                    hasMultipleAudioTracks: hasMultipleAudioTracks
                )
                let shouldIncludeTrack = Self.shouldIncludeAudioTrack(
                    sourceAudioTrack,
                    captureSystemAudio: captureSystemAudio,
                    includeMicrophoneInExport: includeMicrophoneInExport,
                    hasMultipleAudioTracks: hasMultipleAudioTracks
                )
                guard shouldIncludeTrack else { continue }

                let audioTrackSlot = AudioTrackSlot(
                    role: audioTrackRole,
                    ordinal: audioTrackRole == .unknown ? includedAudioTrackOrdinal : 0
                )

                let compositionAudioTrack: AVMutableCompositionTrack
                if let existingAudioTrack = audioTracksBySlot[audioTrackSlot] {
                    compositionAudioTrack = existingAudioTrack
                } else if let newAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                    audioTracksBySlot[audioTrackSlot] = newAudioTrack
                    audioTrackEntries.append(AudioTrackEntry(slot: audioTrackSlot, track: newAudioTrack))
                    compositionAudioTrack = newAudioTrack
                } else {
                    continue
                }

                try compositionAudioTrack.insertTimeRange(timeRange, of: sourceAudioTrack, at: insertTime)
                includedAudioTrackOrdinal += 1
            }

            insertTime = CMTimeAdd(insertTime, duration)
        }

        guard insertTime > .zero else {
            throw RecorderError.noBufferedClip
        }

        let exportedAt = Date()
        let outputDirectory = try ClipStorageManager.resolveNextSaveDirectory(for: saveDirectory)
        let outputURL = Self.makeUniqueOutputURL(in: outputDirectory, exportedAt: exportedAt)
        let applyWatermark = shouldApplyWatermark(for: videoQuality)
        let exactDuration = CMTime(seconds: targetDuration, preferredTimescale: 600)
        let exportTimeRange = CMTimeRange(start: .zero, duration: CMTimeMinimum(insertTime, exactDuration))
        let exportPresets = Self.exportPresetCandidates(for: videoQuality, applyWatermark: applyWatermark)
        var lastError: Error?

        log("export starting segments=\(segments.count) targetDuration=\(String(format: "%.2f", targetDuration)) output=\(outputURL.lastPathComponent) directory=\(outputDirectory.lastPathComponent) presets=\(exportPresets.joined(separator: ","))")

        for preset in exportPresets {
            try? FileManager.default.removeItem(at: outputURL)

            guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) else {
                log("export preset unavailable preset=\(preset)")
                continue
            }

            guard exporter.supportedFileTypes.contains(.mov) else {
                log("export preset missing .mov support preset=\(preset)")
                continue
            }

            exporter.timeRange = exportTimeRange
            exporter.fileLengthLimit = 0
            exporter.shouldOptimizeForNetworkUse = true
            exporter.outputURL = outputURL
            exporter.outputFileType = .mov
            exporter.audioMix = Self.makeAudioMix(
                for: audioTrackEntries,
                systemAudioLevel: systemAudioLevel,
                microphoneAudioLevel: microphoneAudioLevel
            )

            if applyWatermark {
                exporter.videoComposition = makeWatermarkVideoComposition(for: composition, exportedAt: exportedAt, videoQuality: videoQuality)
            }

            do {
                log("export attempt preset=\(preset) output=\(outputURL.lastPathComponent)")
                try await performExport(with: exporter, outputURL: outputURL)

                guard let fileSize = try? outputURL.resourceValues(forKeys: [.fileSizeKey]).fileSize, fileSize >= 1024 else {
                    try? FileManager.default.removeItem(at: outputURL)
                    log("export produced corrupt file preset=\(preset) output=\(outputURL.lastPathComponent)")
                    throw RecorderError.exportFailed("Exported file is too small to be valid.")
                }

                log("export completed preset=\(preset) output=\(outputURL.lastPathComponent)")
                return outputURL
            } catch {
                lastError = error
                log("export attempt failed preset=\(preset) output=\(outputURL.lastPathComponent) message=\(error.localizedDescription)")
            }
        }

        throw lastError ?? RecorderError.exportFailed("Unable to create export session.")
    }

    private func performExport(
        with exporter: AVAssetExportSession,
        outputURL: URL
    ) async throws {
        do {
            try await exporter.export(to: outputURL, as: .mov)
        } catch {
            try? FileManager.default.removeItem(at: outputURL)
            let message = (error as NSError).localizedDescription
            throw RecorderError.exportFailed(message)
        }
    }

    private func log(_ message: String) {
        AppLogger.shared.log("ReplayBuffer", message)
    }

    private func shouldApplyWatermark(for videoQuality: VideoQualityPreset) -> Bool {
        false
    }

    private static func exportPresetCandidates(for videoQuality: VideoQualityPreset, applyWatermark: Bool) -> [String] {
        if applyWatermark {
            return [AVAssetExportPresetHighestQuality, AVAssetExportPresetMediumQuality]
        }

        switch videoQuality {
        case .performance:
            return [AVAssetExportPresetMediumQuality, AVAssetExportPresetHighestQuality]
        case .balanced:
            return [AVAssetExportPresetHighestQuality, AVAssetExportPresetMediumQuality]
        case .highest:
            return [AVAssetExportPresetHighestQuality]
        }
    }

    private static func shouldIncludeAudioTrack(
        _ track: AVAssetTrack,
        captureSystemAudio: Bool,
        includeMicrophoneInExport: Bool,
        hasMultipleAudioTracks: Bool
    ) -> Bool {
        guard captureSystemAudio || includeMicrophoneInExport else { return false }
        guard hasMultipleAudioTracks else { return true }

        switch inferredAudioTrackRole(for: track) {
        case .system:
            return captureSystemAudio
        case .microphone:
            return includeMicrophoneInExport
        case .unknown:
            return captureSystemAudio || includeMicrophoneInExport
        }
    }

    private static func resolvedAudioTrackRole(
        for track: AVAssetTrack,
        captureSystemAudio: Bool,
        includeMicrophoneInExport: Bool,
        hasMultipleAudioTracks: Bool
    ) -> CapturedAudioTrackRole {
        guard hasMultipleAudioTracks else {
            if captureSystemAudio && !includeMicrophoneInExport {
                return .system
            }

            if includeMicrophoneInExport && !captureSystemAudio {
                return .microphone
            }

            return .unknown
        }

        return inferredAudioTrackRole(for: track)
    }

    private static func makeAudioMix(
        for audioTrackEntries: [AudioTrackEntry],
        systemAudioLevel: Double,
        microphoneAudioLevel: Double
    ) -> AVAudioMix? {
        let normalizedSystemAudioLevel = Float(min(1.0, max(0.0, systemAudioLevel)))
        let normalizedMicrophoneAudioLevel = Float(min(2.0, max(0.0, microphoneAudioLevel)))
        let needsSystemMix = audioTrackEntries.contains(where: { $0.slot.role == .system }) && abs(normalizedSystemAudioLevel - 1.0) > 0.001
        let needsMicrophoneMix = audioTrackEntries.contains(where: { $0.slot.role == .microphone }) && abs(normalizedMicrophoneAudioLevel - 1.0) > 0.001

        guard needsSystemMix || needsMicrophoneMix else {
            return nil
        }

        let audioMix = AVMutableAudioMix()
        audioMix.inputParameters = audioTrackEntries.map { entry in
            let parameters = AVMutableAudioMixInputParameters(track: entry.track)
            let volume: Float
            switch entry.slot.role {
            case .system:
                volume = normalizedSystemAudioLevel
            case .microphone:
                volume = normalizedMicrophoneAudioLevel
            case .unknown:
                volume = 1.0
            }
            parameters.setVolume(volume, at: .zero)
            return parameters
        }
        return audioMix
    }

    private static func inferredAudioTrackRole(for track: AVAssetTrack) -> CapturedAudioTrackRole {
        guard let rawFormatDescription = track.formatDescriptions.first else { return .unknown }

        let formatDescription = unsafeBitCast(rawFormatDescription, to: CMFormatDescription.self)
        guard let streamDescriptionPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return .unknown
        }

        let channelCount = Int(streamDescriptionPointer.pointee.mChannelsPerFrame)
        if channelCount <= 1 {
            return .microphone
        }

        if channelCount >= 2 {
            return .system
        }

        return .unknown
    }

    private func makeWatermarkVideoComposition(
        for composition: AVMutableComposition,
        exportedAt: Date,
        videoQuality: VideoQualityPreset
    ) -> AVMutableVideoComposition {
        let videoComposition = AVMutableVideoComposition(propertiesOf: composition)
        let renderSize = videoComposition.renderSize.width > 0 && videoComposition.renderSize.height > 0
            ? videoComposition.renderSize
            : displaySize

        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: videoQuality.preferredFramesPerSecond)

        let parentLayer = CALayer()
        let videoLayer = CALayer()
        parentLayer.frame = CGRect(origin: .zero, size: renderSize)
        videoLayer.frame = parentLayer.frame
        parentLayer.addSublayer(videoLayer)

        let titleFontSize = min(max(renderSize.width * 0.035, 22), 44)
        let detailFontSize = min(max(renderSize.width * 0.018, 11), 20)
        let bottomFontSize = min(max(renderSize.width * 0.016, 10), 16)
        let scale = NSScreen.main?.backingScaleFactor ?? 2

        let centerTitleLayer = Self.makeTextLayer(
            text: "MacClipper",
            fontSize: titleFontSize,
            color: NSColor.white.withAlphaComponent(0.24),
            weight: .bold,
            scale: scale
        )
        centerTitleLayer.frame = CGRect(
            x: renderSize.width * 0.18,
            y: renderSize.height * 0.52,
            width: renderSize.width * 0.64,
            height: titleFontSize * 1.5
        )
        parentLayer.addSublayer(centerTitleLayer)

        let timestampText = Self.displayTimestamp(from: exportedAt)
        let centerDateLayer = Self.makeTextLayer(
            text: timestampText,
            fontSize: detailFontSize,
            color: NSColor.white.withAlphaComponent(0.18),
            weight: .medium,
            scale: scale
        )
        centerDateLayer.frame = CGRect(
            x: renderSize.width * 0.15,
            y: renderSize.height * 0.47,
            width: renderSize.width * 0.70,
            height: detailFontSize * 1.4
        )
        parentLayer.addSublayer(centerDateLayer)

        let bottomLayer = Self.makeTextLayer(
            text: "MacClipper • \(timestampText)",
            fontSize: bottomFontSize,
            color: NSColor(calibratedWhite: 0.96, alpha: 0.60),
            weight: .medium,
            scale: scale
        )
        bottomLayer.frame = CGRect(
            x: renderSize.width * 0.10,
            y: renderSize.height * 0.035,
            width: renderSize.width * 0.80,
            height: bottomFontSize * 1.5
        )
        parentLayer.addSublayer(bottomLayer)

        if let iconImage = Self.applicationIconCGImage() {
            let iconSize = min(max(renderSize.width * 0.055, 26), 54)
            let iconLayer = CALayer()
            iconLayer.contents = iconImage
            iconLayer.contentsGravity = .resizeAspect
            iconLayer.opacity = 0.92
            iconLayer.frame = CGRect(
                x: renderSize.width - iconSize - 18,
                y: renderSize.height - iconSize - 18,
                width: iconSize,
                height: iconSize
            )
            parentLayer.addSublayer(iconLayer)
        }

        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
            postProcessingAsVideoLayer: videoLayer,
            in: parentLayer
        )

        return videoComposition
    }

    private static func makeTextLayer(
        text: String,
        fontSize: CGFloat,
        color: NSColor,
        weight: NSFont.Weight,
        scale: CGFloat
    ) -> CATextLayer {
        let textLayer = CATextLayer()
        textLayer.string = NSAttributedString(
            string: text,
            attributes: [
                .font: NSFont.systemFont(ofSize: fontSize, weight: weight),
                .foregroundColor: color.cgColor
            ]
        )
        textLayer.alignmentMode = .center
        textLayer.contentsScale = scale
        textLayer.isWrapped = false
        return textLayer
    }

    private static func displayTimestamp(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func applicationIconCGImage() -> CGImage? {
        guard let iconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
              let image = NSImage(contentsOf: iconURL) else {
            return nil
        }

        var proposedRect = CGRect(origin: .zero, size: image.size)
        return image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil)
    }
}

private enum CapturedAudioTrackRole {
    case system
    case microphone
    case unknown
}

private final class LiveSegmentWriter: @unchecked Sendable {
    private let finishTimeout: TimeInterval = 2.5
    private let url: URL
    private let assetWriter: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private let systemAudioInput: AVAssetWriterInput?
    private let microphoneInput: AVAssetWriterInput?
    private let finishStateQueue = DispatchQueue(label: "MacClipper.replay-buffer.writer-finish")
    private let configuredDisplaySize: CGSize
    private let screenSampleDescriptor: ScreenSampleDescriptor?

    private(set) var startPTS: CMTime?
    private(set) var latestPTS: CMTime?
    private(set) var startedAt: Date?
    private(set) var latestSampleAt: Date?
    private var hasResumedFinishContinuation = false

    init(
        url: URL,
        displaySize: CGSize,
        includeMicrophone: Bool,
        captureSystemAudio: Bool,
        videoQuality: VideoQualityPreset,
        screenFormatHint: CMFormatDescription?,
        screenSampleDescriptor: ScreenSampleDescriptor?
    ) {
        self.url = url
        self.configuredDisplaySize = displaySize
        self.screenSampleDescriptor = screenSampleDescriptor
        self.assetWriter = try! AVAssetWriter(outputURL: url, fileType: .mov)

        let pixels = max(displaySize.width * displaySize.height, 1_280 * 720)
        let baseBitRate = Int(pixels * videoQuality.bitrateMultiplier)
        let minimumBitRate: Int
        let maximumBitRate: Int

        switch videoQuality {
        case .performance:
            minimumBitRate = 4_500_000
            maximumBitRate = 10_000_000
        case .balanced:
            minimumBitRate = 6_000_000
            maximumBitRate = 14_000_000
        case .highest:
            minimumBitRate = 8_000_000
            maximumBitRate = 20_000_000
        }

        let targetBitRate = min(max(baseBitRate, minimumBitRate), maximumBitRate)
        let expectedFrameRate = max(24, Int(videoQuality.preferredFramesPerSecond))
        let keyFrameInterval = max(expectedFrameRate, 30)

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(displaySize.width),
            AVVideoHeightKey: Int(displaySize.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: targetBitRate,
                AVVideoExpectedSourceFrameRateKey: expectedFrameRate,
                AVVideoMaxKeyFrameIntervalKey: keyFrameInterval,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoAllowFrameReorderingKey: false
            ]
        ]

        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings, sourceFormatHint: screenFormatHint)
        videoInput.expectsMediaDataInRealTime = true
        assetWriter.add(videoInput)

        if captureSystemAudio {
            let audioSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48_000,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 128_000
            ]
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
            input.expectsMediaDataInRealTime = true
            assetWriter.add(input)
            systemAudioInput = input
        } else {
            systemAudioInput = nil
        }

        if includeMicrophone {
            let microphoneSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 96_000
            ]
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: microphoneSettings)
            input.expectsMediaDataInRealTime = true
            assetWriter.add(input)
            microphoneInput = input
        } else {
            microphoneInput = nil
        }
    }

    var screenDescriptorLogDescription: String {
        screenSampleDescriptor?.logDescription
            ?? "\(Int(configuredDisplaySize.width))x\(Int(configuredDisplaySize.height)) unknown"
    }

    func matchesScreenSample(_ descriptor: ScreenSampleDescriptor, displaySize: CGSize) -> Bool {
        configuredDisplaySize == displaySize && screenSampleDescriptor == descriptor
    }

    func shouldRotate(at timestamp: CMTime, segmentDuration: TimeInterval) -> Bool {
        guard let startPTS else { return false }
        return timestamp.seconds - startPTS.seconds >= segmentDuration
    }

    func append(_ sampleBuffer: CMSampleBuffer, as outputType: CapturedSampleOutputType) -> SampleAppendResult {
        if assetWriter.status == .failed || assetWriter.status == .cancelled {
            let message = assetWriter.error?.localizedDescription ?? "writer already failed"
            return .resetNeeded(message)
        }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let sampleDate = Date()

        switch outputType {
        case .screen:
            if assetWriter.status == .unknown {
                guard assetWriter.startWriting() else {
                    let message = assetWriter.error?.localizedDescription ?? "startWriting failed"
                    return .resetNeeded(message)
                }
                assetWriter.startSession(atSourceTime: timestamp)
            }

            if !videoInput.isReadyForMoreMediaData {
                if startPTS == nil {
                    guard videoInput.append(sampleBuffer) else {
                        let message = assetWriter.error?.localizedDescription ?? "video input was not ready for the initial screen sample"
                        return .resetNeeded(message)
                    }

                    startPTS = timestamp
                    startedAt = sampleDate
                    latestPTS = timestamp
                    latestSampleAt = sampleDate
                    return .appended
                }

                return .dropped
            }

            guard videoInput.append(sampleBuffer) else {
                let message = assetWriter.error?.localizedDescription ?? "video append returned false"
                return .resetNeeded(message)
            }

            if startPTS == nil {
                startPTS = timestamp
                startedAt = sampleDate
                    AppLogger.shared.log("ReplayBuffer", "writer accepted first screen sample size=\(Int(configuredDisplaySize.width))x\(Int(configuredDisplaySize.height))")
            }

            latestPTS = timestamp
            latestSampleAt = sampleDate
            return .appended

        case .systemAudio:
            guard assetWriter.status == .writing else { return .dropped }
            if let systemAudioInput, systemAudioInput.isReadyForMoreMediaData {
                _ = systemAudioInput.append(sampleBuffer)
            }
            return .appended

        case .microphone:
            guard assetWriter.status == .writing else { return .dropped }
            if let microphoneInput, microphoneInput.isReadyForMoreMediaData {
                _ = microphoneInput.append(sampleBuffer)
            }
            return .appended
        }
    }

    func cancelAndDiscard() {
        if assetWriter.status == .writing || assetWriter.status == .unknown {
            assetWriter.cancelWriting()
        }

        try? FileManager.default.removeItem(at: url)
    }

    func finish() async -> SegmentInfo? {
        guard startPTS != nil, latestPTS != nil else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }

        finishStateQueue.sync {
            hasResumedFinishContinuation = false
        }

        videoInput.markAsFinished()
        systemAudioInput?.markAsFinished()
        microphoneInput?.markAsFinished()

        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + self.finishTimeout) { [weak self] in
                guard let self else { return }

                if self.assetWriter.status == .writing || self.assetWriter.status == .unknown {
                    self.assetWriter.cancelWriting()
                }

                try? FileManager.default.removeItem(at: self.url)
                self.resumeFinishContinuation(continuation, result: nil)
            }

            assetWriter.finishWriting {
                guard self.assetWriter.status == .completed,
                      let startPTS = self.startPTS,
                      let latestPTS = self.latestPTS else {
                    try? FileManager.default.removeItem(at: self.url)
                    self.resumeFinishContinuation(continuation, result: nil)
                    return
                }

                let duration = max(0, CMTimeSubtract(latestPTS, startPTS).seconds)
                let startedAt = self.startedAt ?? Date().addingTimeInterval(-duration)
                let endedAt = self.latestSampleAt ?? startedAt.addingTimeInterval(duration)

                self.resumeFinishContinuation(
                    continuation,
                    result: SegmentInfo(
                        url: self.url,
                        startedAt: startedAt,
                        endedAt: endedAt,
                        startPTS: startPTS,
                        endPTS: latestPTS,
                        duration: duration
                    )
                )
            }
        }
    }

    private func resumeFinishContinuation(
        _ continuation: CheckedContinuation<SegmentInfo?, Never>,
        result: SegmentInfo?
    ) {
        let shouldResume = finishStateQueue.sync { () -> Bool in
            guard !hasResumedFinishContinuation else { return false }
            hasResumedFinishContinuation = true
            return true
        }

        guard shouldResume else { return }
        continuation.resume(returning: result)
    }
}
