import SwiftUI
import ReplayKit

@main
struct IosClipperApp: App {
    @StateObject private var model = IosClipperModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
    }
}

@MainActor
final class IosClipperModel: ObservableObject {
    @Published var isRecording = false
    @Published var statusText = "Ready to clip"
    @Published var lastClipURL: URL?

    private let recorder = RPScreenRecorder.shared()

    func startRecording() {
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

    func stopRecording() {
        guard isRecording else { return }
        recorder.stopRecording { [weak self] previewController, error in
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
