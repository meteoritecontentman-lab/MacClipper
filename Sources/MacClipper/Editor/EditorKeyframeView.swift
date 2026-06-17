import SwiftUI

struct EditorKeyframeView: View {
    @Binding var keyframes: [EditorKeyframe]
    let duration: Double
    let onSelectKeyframe: (EditorKeyframe) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Keyframes")
                .font(.system(size: 13, weight: .bold))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(keyframes) { keyframe in
                        Button(action: { onSelectKeyframe(keyframe) }) {
                            VStack(spacing: 2) {
                                Circle()
                                    .fill(Color.orange)
                                    .frame(width: 14, height: 14)
                                Text("\(String(format: "%.2f", keyframe.time))s")
                                    .font(.system(size: 10, weight: .medium))
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.04)))
    }
}
