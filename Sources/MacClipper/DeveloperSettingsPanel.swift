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

            DeveloperEmailComposer(density: density)
                .environmentObject(model)
        }
    }
}

private struct DeveloperEmailComposer: View {
    @EnvironmentObject private var model: AppModel
    let density: SlateDensity

    @State private var isExpanded = false
    @State private var subject = ""
    @State private var htmlBody = ""
    @State private var textBody = ""
    @State private var recipientMode: RecipientMode = .all
    @State private var customEmails = ""
    @State private var attachedImages: [AttachedImage] = []
    @State private var isSending = false

    private enum RecipientMode: String, CaseIterable, Identifiable {
        case all = "All Users"
        case custom = "Specific Emails"
        var id: String { rawValue }
    }

    private struct AttachedImage: Identifiable {
        let id = UUID()
        let url: URL
        let cid: String
        var data: Data?
        var filename: String { url.lastPathComponent }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SlatePanelDivider()
            Button {
                withAnimation { isExpanded.toggle() }
            } label: {
                HStack {
                    SlateSectionCaption(title: "Email Composer", density: density)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(SlateTheme.textTertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    SlateFieldChrome {
                        TextField("Subject", text: $subject)
                            .textFieldStyle(.plain)
                            .font(.system(size: density == .compact ? 11 : 13, weight: .semibold))
                            .foregroundStyle(SlateTheme.textPrimary)
                    }

                    SlateFieldChrome {
                        Picker("Recipients", selection: $recipientMode) {
                            ForEach(RecipientMode.allCases) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.segmented)
                    }

                    if recipientMode == .custom {
                        SlateFieldChrome {
                            TextField("Emails (comma separated)", text: $customEmails)
                                .textFieldStyle(.plain)
                                .font(.system(size: density == .compact ? 10 : 12, weight: .medium, design: .monospaced))
                                .foregroundStyle(SlateTheme.textPrimary)
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("HTML Body")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(SlateTheme.textSecondary)
                        SlateFieldChrome {
                            ScrollView {
                                TextEditor(text: $htmlBody)
                                    .font(.system(size: density == .compact ? 10 : 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(SlateTheme.textPrimary)
                                    .frame(minHeight: 120)
                                    .scrollContentBackground(.hidden)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Text Body (fallback)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(SlateTheme.textSecondary)
                        SlateFieldChrome {
                            ScrollView {
                                TextEditor(text: $textBody)
                                    .font(.system(size: density == .compact ? 10 : 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(SlateTheme.textPrimary)
                                    .frame(minHeight: 60)
                                    .scrollContentBackground(.hidden)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Attached Images")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(SlateTheme.textSecondary)
                        HStack(spacing: 6) {
                            Button {
                                pickImages()
                            } label: {
                                SlateCapsuleButtonLabel(
                                    title: "Add Images",
                                    systemImage: "photo.on.rectangle",
                                    tint: SlateTheme.accent,
                                    density: density
                                )
                            }
                            .buttonStyle(.plain)

                            if !attachedImages.isEmpty {
                                Text("\(attachedImages.count) image(s)")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(SlateTheme.textTertiary)
                            }
                        }
                        if !attachedImages.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(attachedImages) { img in
                                        VStack(spacing: 2) {
                                            if let preview = img.data.flatMap({ NSImage(data: $0) }) {
                                                Image(nsImage: preview)
                                                    .resizable()
                                                    .frame(width: 60, height: 40)
                                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                            }
                                            Text(img.filename)
                                                .font(.system(size: 8, weight: .medium))
                                                .foregroundStyle(SlateTheme.textTertiary)
                                                .lineLimit(1)
                                            Text("cid:\(img.cid)")
                                                .font(.system(size: 7, weight: .regular, design: .monospaced))
                                                .foregroundStyle(SlateTheme.textTertiary)
                                        }
                                        .frame(width: 72)
                                    }
                                }
                            }
                        }
                        Text("Use <img src=\"cid:YOUR_CID\"> in HTML to embed")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(SlateTheme.textTertiary)
                    }

                    HStack(spacing: 6) {
                        Button {
                            sendEmail()
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: isSending ? "Sending..." : "Send Email",
                                systemImage: "paperplane.fill",
                                tint: SlateTheme.success,
                                highlighted: true,
                                density: density
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(isSending || subject.isEmpty || htmlBody.isEmpty)

                        Button {
                            attachedImages = []
                            subject = ""
                            htmlBody = ""
                            textBody = ""
                            customEmails = ""
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: "Clear",
                                systemImage: "trash",
                                tint: SlateTheme.textPrimary,
                                density: density
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 4)
            }
        }
    }

    private func pickImages() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.image]
        panel.begin { result in
            guard result == .OK else { return }
            for url in panel.urls {
                let cid = "img\(attachedImages.count + 1)"
                let data = try? Data(contentsOf: url)
                attachedImages.append(AttachedImage(url: url, cid: cid, data: data))
            }
        }
    }

    private func sendEmail() {
        isSending = true
        let images = attachedImages.compactMap { img -> DeveloperAdminClient.EmailImage? in
            guard let data = img.data else { return nil }
            return DeveloperAdminClient.EmailImage(
                filename: img.filename,
                contentBase64: data.base64EncodedString(),
                cid: img.cid
            )
        }

        let recipients: DeveloperAdminClient.EitherAllOrEmails
        if recipientMode == .custom {
            let emails = customEmails
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            recipients = .specific(emails)
        } else {
            recipients = .all
        }

        model.developerSendEmail(
            recipients: recipients,
            subject: subject,
            htmlBody: htmlBody,
            textBody: textBody.isEmpty ? nil : textBody,
            images: images
        )

        isSending = false
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

            HStack(spacing: 6) {
                if installation.hasPro {
                    Button {
                        model.developerRevokePro(appUuid: installation.installation.appUuid)
                    } label: {
                        SlateCapsuleButtonLabel(
                            title: "Revoke Pro",
                            systemImage: "xmark.seal.fill",
                            tint: SlateTheme.warning,
                            density: density
                        )
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        model.developerGrantPro(appUuid: installation.installation.appUuid)
                    } label: {
                        SlateCapsuleButtonLabel(
                            title: "Grant Pro",
                            systemImage: "checkmark.seal.fill",
                            tint: SlateTheme.success,
                            density: density
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
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