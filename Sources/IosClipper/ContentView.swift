import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: IosClipperModel

    var body: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 32)

            VStack(spacing: 16) {
                Image(systemName: "record.circle")
                    .font(.system(size: 80))
                    .foregroundStyle(model.isRecording ? .red : .secondary)
                    .accessibilityHidden(true)

                Text("IosClipper")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)

                Text(model.statusText)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer(minLength: 32)

            Button {
                if model.isRecording {
                    model.stopRecording()
                } else {
                    model.startRecording()
                }
            } label: {
                Label(
                    model.isRecording ? "Stop" : "Start Recording",
                    systemImage: model.isRecording ? "stop.fill" : "record.circle"
                )
                .font(.title2.bold())
                .frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.borderedProminent)
            .tint(model.isRecording ? .red : .accentColor)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
#Preview("Ready") {
    ContentView()
        .environmentObject(IosClipperModel.preview(statusText: "Ready to clip"))
}

#Preview("Recording") {
    ContentView()
        .environmentObject(IosClipperModel.preview(isRecording: true, statusText: "Recording..."))
}

