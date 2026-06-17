import SwiftUI

struct DeveloperSettingsPanel: View {
    @EnvironmentObject private var model: AppModel

    let density: SlateDensity

    private var accessTokenBinding: Binding<String> {
        Binding(
            get: { model.developerAccessToken },
            set: { model.developerAccessToken = $0 }
        )
    }

    private var searchBinding: Binding<String> {
        Binding(
            get: { model.developerSearchText },
            set: { model.developerSearchText = $0 }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SlatePanelDivider()
            SlateSectionCaption(title: "Developer", density: density)

            SlateRow(
                title: "Firebase Admin",
                subtitle: model.developerStatusText,
                systemImage: "lock.shield.fill",
                isSelected: !model.developerAccessToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                tint: SlateTheme.accent,
                density: density
            ) {
                VStack(alignment: .trailing, spacing: 8) {
                    SlateFieldChrome {
                        SecureField("Developer Access Token", text: accessTokenBinding)
                            .textFieldStyle(.plain)
                            .foregroundStyle(SlateTheme.textPrimary)
                            .font(.system(size: density == .compact ? 11 : 13, weight: .semibold, design: .monospaced))
                    }
                    .frame(width: density == .compact ? 220 : 280)

                    HStack(spacing: 6) {
                        Button {
                            model.developerAuthenticate()
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: model.isDeveloperBusy ? "Connecting..." : "Sign In",
                                systemImage: "bolt.shield",
                                tint: SlateTheme.textPrimary,
                                highlighted: true,
                                density: density
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(model.isDeveloperBusy)

                        Button {
                            model.developerSignOut()
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: "Sign Out",
                                systemImage: "rectangle.portrait.and.arrow.right",
                                tint: SlateTheme.textPrimary,
                                density: density
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(model.isDeveloperBusy)
                    }
                }
            }

            SlateRow(
                title: "Tracked Macs",
                subtitle: model.developerInstallationCountText,
                systemImage: "desktopcomputer.trianglebadge.exclamationmark",
                isSelected: !model.developerInstallations.isEmpty,
                tint: SlateTheme.warning,
                density: density
            ) {
                Button {
                    model.refreshDeveloperInstallations()
                } label: {
                    SlateCapsuleButtonLabel(
                        title: model.isDeveloperBusy ? "Refreshing..." : "Refresh",
                        systemImage: "arrow.clockwise",
                        tint: SlateTheme.textPrimary,
                        density: density
                    )
                }
                .buttonStyle(.plain)
                .disabled(model.isDeveloperBusy)
            }

            if !model.developerInstallations.isEmpty {
                SlateInsetPanel {
                    VStack(alignment: .leading, spacing: 10) {
                        SlateFieldChrome {
                            TextField("Search by UUID, machine, email, or Discord name", text: searchBinding)
                                .textFieldStyle(.plain)
                                .foregroundStyle(SlateTheme.textPrimary)
                                .font(.system(size: density == .compact ? 11 : 13, weight: .semibold))
                        }

                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(model.filteredDeveloperInstallations) { installation in
                                DeveloperInstallationRow(installation: installation, density: density)
                                    .environmentObject(model)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct DeveloperInstallationRow: View {
    @EnvironmentObject private var model: AppModel

    let installation: DeveloperInstallationSummary
    let density: SlateDensity

    private var machineTitle: String {
        installation.linkedUser?.displayName.isEmpty == false
            ? installation.linkedUser?.displayName ?? installation.installation.machineName
            : installation.installation.machineName
    }

    private var subtitle: String {
        var segments = [String]()

        if !installation.installation.machineModel.isEmpty {
            segments.append(installation.installation.machineModel)
        }

        if !installation.installation.appVersion.isEmpty {
            let build = installation.installation.buildVersion.isEmpty ? "" : " (\(installation.installation.buildVersion))"
            segments.append("v\(installation.installation.appVersion)\(build)")
        }

        if let email = installation.linkedUser?.email, !email.isEmpty {
            segments.append(email)
        }

        return segments.joined(separator: " • ")
    }

    private var statusTint: Color {
        installation.hasPro ? SlateTheme.success : SlateTheme.warning
    }

    private var statusTitle: String {
        installation.hasPro ? "Pro Active" : "Free"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(machineTitle)
                        .font(.system(size: density == .compact ? 12 : 14, weight: .bold))
                        .foregroundStyle(SlateTheme.textPrimary)

                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: density == .compact ? 10 : 12, weight: .medium))
                            .foregroundStyle(SlateTheme.textSecondary)
                    }

                    Text(installation.installation.appUuid)
                        .font(.system(size: density == .compact ? 10 : 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(SlateTheme.textTertiary)

                    if !installation.installation.lastSeenAt.isEmpty {
                        Text("Last seen: \(installation.installation.lastSeenAt)")
                            .font(.system(size: density == .compact ? 10 : 11, weight: .medium))
                            .foregroundStyle(SlateTheme.textSecondary)
                    }
                }

                Spacer(minLength: 0)

                SlateStatusBadge(title: statusTitle, tint: statusTint)
            }

            Text("Pro grants are managed by billing entitlements only.")
                .font(.system(size: density == .compact ? 10 : 11, weight: .medium))
                .foregroundStyle(SlateTheme.textSecondary)
        }
        .padding(density == .compact ? 10 : 12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(SlateTheme.control)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(SlateTheme.controlBorder, lineWidth: 1)
        )
    }
}