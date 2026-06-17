import SwiftUI

struct MenuTabButton: View {
    let icon: String
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(isSelected ? SlateTheme.accent : SlateTheme.textSecondary)
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(isSelected ? SlateTheme.accent : SlateTheme.textTertiary)
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .background(isSelected ? SlateTheme.accentSoft : Color.clear)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }
}
