import SwiftUI
import ReplayKit

@main
struct IosClipperApp: App {
    @StateObject private var model = IosClipperRecordingModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
    }
}

@MainActor
class IosClipperModel: ObservableObject {
    @Published var isRecording = false
    @Published var statusText = "Ready to clip"
    @Published var lastClipURL: URL?

    static func preview(isRecording: Bool = false, statusText: String = "Ready to clip") -> IosClipperModel {
        let model = IosClipperPreviewModel()
        model.isRecording = isRecording
        model.statusText = statusText
        return model
    }

    func startRecording() {}

    func stopRecording() {}
}

@MainActor
final class IosClipperPreviewModel: IosClipperModel {}

@MainActor
final class IosClipperRecordingModel: IosClipperModel {
    private lazy var recorder = RPScreenRecorder.shared()

    override func startRecording() {
        guard !isRecording else { return }
        recorder.isMicrophoneEnabled = true
        recorder.startRecording { [weak self] error in
            DispatchQueue.main.async {
                if let error {
                    self?.statusText = "Start failed: \(error.localizedDescription)"
                } else {
                    self?.isRecording = true
                    self?.statusText = "Recording..."
                }
            }
        }
    }

    override func stopRecording() {
        guard isRecording else { return }
        recorder.stopRecording { [weak self] _, error in
            DispatchQueue.main.async {
                self?.isRecording = false
                if let error {
                    self?.statusText = "Stop failed: \(error.localizedDescription)"
                } else {
                    self?.statusText = "Clip saved"
                }
            }
        }
    }
}
