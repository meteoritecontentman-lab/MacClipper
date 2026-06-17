import SwiftUI

struct ClipEditorAccessPopover: View {
    @EnvironmentObject private var model: AppModel

    let clipName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                if let icon = MacClipperIconAsset.image(size: 34) {
                    Image(nsImage: icon)
                        .resizable()
                        .frame(width: 34, height: 34)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                } else {
                    SlateIconBadge(systemImage: "scissors", tint: SlateTheme.accent, density: .compact)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text("Edit in MacClipper")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(SlateTheme.textPrimary)

                    Text(clipName)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(SlateTheme.textSecondary)
                        .lineLimit(1)
                }
            }

            Text("MacClipper Editor is part of MacClipper PRO. Unlock it to trim, stack, and export this clip in a dedicated desktop window.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(SlateTheme.textSecondary)

            Button {
                model.open4KPurchasePage()
            } label: {
                SlateCapsuleButtonLabel(
                    title: "Unlock PRO",
                    systemImage: "star.fill",
                    tint: SlateTheme.textPrimary,
                    highlighted: true,
                    density: .compact
                )
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .frame(width: 320)
        .background(SlateTheme.panel)
    }
}