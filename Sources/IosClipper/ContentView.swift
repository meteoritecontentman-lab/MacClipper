import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: IosClipperModel

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "record.circle")
                .font(.system(size: 80))
                .foregroundStyle(model.isRecording ? .red : .secondary)

            Text("IosClipper")
                .font(.largeTitle.bold())

            Text(model.statusText)
                .font(.headline)
                .foregroundStyle(.secondary)

            Spacer()

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
                .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .tint(model.isRecording ? .red : .accentColor)
            .padding(.horizontal, 40)

            Spacer()
        }
    }
}
