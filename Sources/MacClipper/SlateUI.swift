import SwiftUI

enum SlateDensity {
    case regular
    case compact
}

enum SlateTheme {
    static let accent = Color(red: 0.08, green: 0.49, blue: 0.98)
    static let accentSoft = accent.opacity(0.18)
    static let success = Color(red: 0.12, green: 0.76, blue: 0.44)
    static let warning = Color(red: 0.93, green: 0.76, blue: 0.38)
    static let panel = Color(red: 0.32, green: 0.33, blue: 0.35).opacity(0.96)
    static let panelBorder = Color.white.opacity(0.11)
    static let row = Color(red: 0.23, green: 0.25, blue: 0.28).opacity(0.95)
    static let rowBorder = Color.white.opacity(0.06)
    static let control = Color(red: 0.27, green: 0.29, blue: 0.32).opacity(0.96)
    static let controlBorder = Color.white.opacity(0.08)
    static let divider = Color.white.opacity(0.12)
    static let textPrimary = Color.white.opacity(0.94)
    static let textSecondary = Color.white.opacity(0.72)
    static let textTertiary = Color.white.opacity(0.46)
    static let shadow = Color.black.opacity(0.38)
}

struct SlatePanel<Content: View>: View {
    private let cornerRadius: CGFloat
    private let padding: CGFloat
    private let content: Content

    init(cornerRadius: CGFloat = 30, padding: CGFloat = 18, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(SlateTheme.panel)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(SlateTheme.panelBorder, lineWidth: 1)
            )
            .shadow(color: SlateTheme.shadow, radius: 26, y: 14)
    }
}

struct SlateInsetPanel<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(SlateTheme.row)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(SlateTheme.rowBorder, lineWidth: 1)
            )
    }
}

struct SlatePanelDivider: View {
    var body: some View {
        Rectangle()
            .fill(SlateTheme.divider)
            .frame(height: 1)
    }
}

struct SlateSectionCaption: View {
    let title: String
    let density: SlateDensity

    init(title: String, density: SlateDensity = .regular) {
        self.title = title
        self.density = density
    }

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: density == .compact ? 11 : 13, weight: .bold))
            .tracking(density == .compact ? 1.3 : 1.8)
            .foregroundStyle(SlateTheme.textTertiary)
    }
}

struct SlateSelectionIndicator: View {
    let isSelected: Bool
    let density: SlateDensity

    init(isSelected: Bool, density: SlateDensity = .regular) {
        self.isSelected = isSelected
        self.density = density
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(isSelected ? SlateTheme.accent : SlateTheme.textSecondary, lineWidth: 2)

            if isSelected {
                Circle()
                    .fill(SlateTheme.accent)
                    .padding(density == .compact ? 3 : 4)
            }
        }
        .frame(width: density == .compact ? 15 : 18, height: density == .compact ? 15 : 18)
    }
}

struct SlateIconBadge: View {
    let systemImage: String
    let tint: Color
    let density: SlateDensity

    init(systemImage: String, tint: Color = SlateTheme.textPrimary, density: SlateDensity = .regular) {
        self.systemImage = systemImage
        self.tint = tint
        self.density = density
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: density == .compact ? 8 : 10, style: .continuous)
                .fill(Color.white.opacity(0.06))

            Image(systemName: systemImage)
                .font(.system(size: density == .compact ? 14 : 17, weight: .semibold))
                .foregroundStyle(tint)
        }
        .frame(width: density == .compact ? 30 : 36, height: density == .compact ? 30 : 36)
    }
}

struct SlateToolbarButtonLabel: View {
    let systemImage: String
    let tint: Color
    let isHighlighted: Bool
    let density: SlateDensity

    init(systemImage: String, tint: Color = SlateTheme.textPrimary, isHighlighted: Bool = false, density: SlateDensity = .regular) {
        self.systemImage = systemImage
        self.tint = tint
        self.isHighlighted = isHighlighted
        self.density = density
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: density == .compact ? 9 : 11, style: .continuous)
                .fill(isHighlighted ? SlateTheme.accentSoft : SlateTheme.control)

            RoundedRectangle(cornerRadius: density == .compact ? 9 : 11, style: .continuous)
                .stroke(isHighlighted ? SlateTheme.accent.opacity(0.42) : SlateTheme.controlBorder, lineWidth: 1)

            Image(systemName: systemImage)
                .font(.system(size: density == .compact ? 12 : 14, weight: .bold))
                .foregroundStyle(tint)
        }
        .frame(width: density == .compact ? 32 : 38, height: density == .compact ? 32 : 38)
    }
}

struct SlateCapsuleButtonLabel: View {
    let title: String
    let systemImage: String?
    let tint: Color
    let highlighted: Bool
    let density: SlateDensity

    init(title: String, systemImage: String? = nil, tint: Color = SlateTheme.textPrimary, highlighted: Bool = false, density: SlateDensity = .regular) {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
        self.highlighted = highlighted
        self.density = density
    }

    var body: some View {
        HStack(spacing: density == .compact ? 5 : 7) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: density == .compact ? 10 : 11, weight: .bold))
            }

            Text(title)
                .font(.system(size: density == .compact ? 12 : 13, weight: .semibold))
                .lineLimit(1)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, density == .compact ? 10 : 12)
        .padding(.vertical, density == .compact ? 6 : 8)
        .background(
            Capsule(style: .continuous)
                .fill(highlighted ? SlateTheme.accentSoft : SlateTheme.control)
        )
        .overlay(
            Capsule(style: .continuous)
                .stroke(highlighted ? SlateTheme.accent.opacity(0.42) : SlateTheme.controlBorder, lineWidth: 1)
        )
    }
}

struct SlateStatusBadge: View {
    let title: String
    let tint: Color

    var body: some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(SlateTheme.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(tint.opacity(0.18))
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(tint.opacity(0.34), lineWidth: 1)
            )
    }
}

struct SlateFieldChrome<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(SlateTheme.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(SlateTheme.controlBorder, lineWidth: 1)
            )
    }
}

extension View {
    func placeholder<Content: View>(
        when shouldShow: Bool,
        alignment: Alignment = .leading,
        @ViewBuilder placeholder: () -> Content
    ) -> some View {
        ZStack(alignment: alignment) {
            placeholder().opacity(shouldShow ? 1 : 0)
            self
        }
    }
}

struct SlateMeterBar: View {
    let value: Double

    var body: some View {
        GeometryReader { proxy in
            let clampedValue = min(max(value, 0), 1)
            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Color.black.opacity(0.18))

                if clampedValue > 0 {
                    Capsule(style: .continuous)
                        .fill(SlateTheme.accent)
                        .frame(width: max(10, proxy.size.width * clampedValue))
                }
            }
        }
        .frame(height: 7)
    }
}

struct SlateToggleButton: View {
    @Binding var isOn: Bool
    let onTitle: String
    let offTitle: String

    init(isOn: Binding<Bool>, onTitle: String = "On", offTitle: String = "Off") {
        _isOn = isOn
        self.onTitle = onTitle
        self.offTitle = offTitle
    }

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(isOn ? SlateTheme.accent : SlateTheme.textTertiary)
                    .frame(width: 8, height: 8)

                Text(isOn ? onTitle : offTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(SlateTheme.textPrimary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule(style: .continuous)
                    .fill(isOn ? SlateTheme.accentSoft : SlateTheme.control)
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(isOn ? SlateTheme.accent.opacity(0.42) : SlateTheme.controlBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

struct SlateRow<Trailing: View>: View {
    let title: String
    let subtitle: String?
    let systemImage: String
    let isSelected: Bool
    let tint: Color
    let density: SlateDensity
    private let trailing: Trailing

    init(
        title: String,
        subtitle: String? = nil,
        systemImage: String,
        isSelected: Bool = false,
        tint: Color = SlateTheme.textPrimary,
        density: SlateDensity = .regular,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.isSelected = isSelected
        self.tint = tint
        self.density = density
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .center, spacing: density == .compact ? 10 : 14) {
            SlateSelectionIndicator(isSelected: isSelected, density: density)
            SlateIconBadge(systemImage: systemImage, tint: tint, density: density)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: density == .compact ? 13 : 15, weight: .semibold))
                    .foregroundStyle(SlateTheme.textPrimary)
                    .lineLimit(1)

                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: density == .compact ? 11 : 12, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                        .lineLimit(density == .compact ? 1 : nil)
                        .fixedSize(horizontal: false, vertical: density == .compact ? false : true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            trailing
        }
        .padding(.horizontal, density == .compact ? 11 : 14)
        .padding(.vertical, density == .compact ? 9 : 12)
        .background(
            RoundedRectangle(cornerRadius: density == .compact ? 13 : 16, style: .continuous)
                .fill(SlateTheme.row)
        )
        .overlay(
            RoundedRectangle(cornerRadius: density == .compact ? 13 : 16, style: .continuous)
                .stroke(isSelected ? SlateTheme.accent.opacity(0.32) : SlateTheme.rowBorder, lineWidth: 1)
        )
    }
}