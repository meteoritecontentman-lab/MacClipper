import SwiftUI
import AVKit

struct EditorTimelineView: View {
    @Binding var tracks: [EditorTimelineTrack]
    @Binding var playhead: Double
    let duration: Double
    let onSelectItem: (EditorTimelineItem) -> Void

    var body: some View {
        VStack {
            Text("Timeline View")
                .foregroundColor(SlateTheme.textPrimary)
                .font(.system(size: 14, weight: .bold))

            Text("Timeline functionality temporarily disabled for build")
                .foregroundColor(SlateTheme.textSecondary)
                .font(.system(size: 12))

            Text("Tracks: \(tracks.count), Duration: \(String(format: "%.1f", duration))s")
                .foregroundColor(SlateTheme.textTertiary)
                .font(.system(size: 10))

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SlateTheme.control)
        .cornerRadius(8)
    }
}
