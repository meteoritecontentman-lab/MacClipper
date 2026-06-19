import SwiftUI

struct MenuSettingsPage: View {
    @EnvironmentObject private var model: AppModel

    let onBack: () -> Void

    @State private var diagnosticsExpanded = false
    @State private var audioSourceSelection: AudioSourceSelection = .microphoneOnly
    @State private var showVirtualDeviceSetup = false

    private let density: SlateDensity = .compact

    private var audioSourceWarning: String? {
        switch audioSourceSelection {
        case .both:
            return "MacClipper mixes mic and desktop audio in-app (no system virtual device needed)."
        case .systemAudioOnly:
            return "Desktop audio will be captured via ScreenCaptureKit."
        default:
            break
        }
        return nil
    }

    private var statusBinding: Binding<UserStatus> {
        Binding(
            get: { model.userStatus },
            set: { newValue in
                model.userStatus = newValue
                model.savePreferences()
                Task {
                    try? await CommunityClipsClient.shared.updateProfileStatus(
                        profileID: model.websiteUserID,
                        status: newValue
                    )
                }
            }
        )
    }

    private func statusIcon(for status: UserStatus) -> String {
        switch status {
        case .online: return "circle.fill"
        case .idle: return "moon.fill"
        case .dnd: return "minus.circle.fill"
        case .offline: return "circle.slash.fill"
        }
    }

    private func statusTint(for status: UserStatus) -> Color {
        switch status {
        case .online: return Color.green
        case .idle: return Color.yellow
        case .dnd: return Color.red
        case .offline: return Color.gray
        }
    }

    private func statusColor(_ status: UserStatus) -> Color {
        switch status {
        case .online: return Color.green
        case .idle: return Color.yellow
        case .dnd: return Color.red
        case .offline: return Color.gray
        }
    }

    private var notificationsBinding: Binding<Bool> {
        Binding(
            get: { model.enableGameNotifications },
            set: { newValue in
                model.enableGameNotifications = newValue
                model.savePreferences()
            }
        )
    }

    private var microphoneBinding: Binding<Bool> {
        Binding(
            get: { model.includeMicrophone },
            set: { newValue in
                model.includeMicrophone = newValue
                model.savePreferences()
            }
        )
    }

    private var microphoneDeviceBinding: Binding<String> {
        Binding(
            get: { model.selectedMicrophoneID },
            set: { newValue in
                model.setSelectedMicrophoneID(newValue)
                model.savePreferences()
            }
        )
    }

    private var systemAudioBinding: Binding<Bool> {
        Binding(
            get: { model.captureSystemAudio },
            set: { newValue in
                model.captureSystemAudio = newValue
                model.savePreferences()
            }
        )
    }

    private var systemAudioLevelBinding: Binding<Double> {
        Binding(
            get: { model.systemAudioLevel * 100 },
            set: { newValue in
                model.systemAudioLevel = newValue / 100
                model.savePreferences()
            }
        )
    }

    private var microphoneAudioLevelBinding: Binding<Double> {
        Binding(
            get: { model.microphoneAudioLevel * 100 },
            set: { newValue in
                model.microphoneAudioLevel = newValue / 100
                model.savePreferences()
            }
        )
    }

    private var showCursorBinding: Binding<Bool> {
        Binding(
            get: { model.showCursor },
            set: { newValue in
                model.showCursor = newValue
                model.savePreferences()
            }
        )
    }

    private var useCommandBinding: Binding<Bool> {
        binding(for: \.useCommand)
    }

    private var useShiftBinding: Binding<Bool> {
        binding(for: \.useShift)
    }

    private var useOptionBinding: Binding<Bool> {
        binding(for: \.useOption)
    }

    private var useControlBinding: Binding<Bool> {
        binding(for: \.useControl)
    }

    private var captureDisplayBinding: Binding<String> {
        Binding(
            get: { model.selectedCaptureDisplayID },
            set: { model.setSelectedCaptureDisplayID($0) }
        )
    }

    private var videoQualityBinding: Binding<VideoQualityPreset> {
        Binding(
            get: { model.videoQualityPreset },
            set: { model.setVideoQualityPreset($0) }
        )
    }

    private var resolutionBinding: Binding<CaptureResolutionPreset> {
        Binding(
            get: { model.captureResolutionPreset },
            set: { model.setCaptureResolutionPreset($0) }
        )
    }

    private var clipDurationBinding: Binding<Double> {
        Binding(
            get: { model.clipDuration },
            set: {
                model.clipDuration = $0
                model.savePreferences()
            }
        )
    }

    private var automaticUpdatesBinding: Binding<Bool> {
        Binding(
            get: { model.updater.automaticallyChecksForUpdates },
            set: {
                model.updater.automaticallyChecksForUpdates = $0
                model.updater.savePreferences()
            }
        )
    }

    private var launchUpdateChecksBinding: Binding<Bool> {
        Binding(
            get: { model.updater.checksForUpdatesOnLaunch },
            set: {
                model.updater.checksForUpdatesOnLaunch = $0
                model.updater.savePreferences()
            }
        )
    }

    private var shortcutKeyBinding: Binding<String> {
        Binding(
            get: { model.shortcutKey },
            set: {
                model.shortcutKey = $0
                model.savePreferences()
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    // Audio Source Selection
                    SlateSectionCaption(title: "Audio Source", density: density)
                    SlateRow(
                        title: "Audio Source",
                        subtitle: audioSourceSelection.rawValue,
                        systemImage: "waveform.circle",
                        isSelected: true,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        Picker("Audio Source", selection: $audioSourceSelection) {
                            ForEach(AudioSourceSelection.allCases) { option in
                                Text(option.rawValue).tag(option)
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(width: 220)
                        .onChange(of: audioSourceSelection) { newValue in
                            if newValue == .both || newValue == .systemAudioOnly {
                                showVirtualDeviceSetup = true
                            }
                        }
                    }
                    if let warning = audioSourceWarning {
                        Text(warning)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 2)
                    }
                    Button("Audio Engine") {
                        showVirtualDeviceSetup = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.accentColor)
                    if showVirtualDeviceSetup {
                        VirtualAudioDeviceSetupWizard(isPresented: $showVirtualDeviceSetup)
                    }
                    SlatePanelDivider()
                    SlateSectionCaption(title: "Editor", density: density)
                    SlateRow(
                        title: "MacClipper Editor",
                        subtitle: "MacClipper Editor opens in a dedicated MacClipper window.",
                        systemImage: "scissors",
                        isSelected: model.hasUnlocked4KPro,
                        tint: model.hasUnlocked4KPro ? SlateTheme.accent : SlateTheme.warning,
                        density: density
                    ) {
                        SlateStatusBadge(title: model.hasUnlocked4KPro ? "Ready" : "PRO", tint: model.hasUnlocked4KPro ? SlateTheme.accent : SlateTheme.warning)
                    }
                    SlateSectionCaption(title: "Capture", density: density)

                    SlateRow(
                        title: "Capture Display",
                        subtitle: model.selectedCaptureDisplaySummary,
                        systemImage: "display.2",
                        isSelected: true,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        SlateFieldChrome {
                            Picker("Monitor", selection: captureDisplayBinding) {
                                ForEach(model.availableCaptureDisplays) { display in
                                    Text(display.title).tag(display.id)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            .tint(SlateTheme.textPrimary)
                        }
                        .frame(width: 180)
                    }

                    SlateRow(
                        title: "Clip Length",
                        subtitle: "Save the last \(Int(model.clipDuration)) seconds.",
                        systemImage: "timer",
                        isSelected: true,
                        tint: SlateTheme.warning,
                        density: density
                    ) {
                        HStack(spacing: 8) {
                            Slider(value: clipDurationBinding, in: 15...120, step: 5)
                                .tint(SlateTheme.accent)
                                .frame(width: 120)

                            Text("\(Int(model.clipDuration))s")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(SlateTheme.textPrimary)
                                .frame(width: 34, alignment: .trailing)
                        }
                    }

                    SlateRow(
                        title: "Video Quality",
                        subtitle: model.videoQualityPreset.displayName,
                        systemImage: "sparkles",
                        isSelected: true,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        MenuSettingsQualitySelector(selection: videoQualityBinding)
                    }

                    SlateRow(
                        title: "Resolution",
                        subtitle: model.captureResolutionSelectionSummary,
                        systemImage: "rectangle.compress.vertical",
                        isSelected: true,
                        tint: SlateTheme.warning,
                        density: density
                    ) {
                        SlateFieldChrome {
                            Picker("Resolution", selection: resolutionBinding) {
                                ForEach(CaptureResolutionPreset.allCases) { preset in
                                    Text(model.captureResolutionOptionTitle(for: preset)).tag(preset)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            .tint(SlateTheme.textPrimary)
                        }
                        .frame(width: 170)
                    }

                    SlateRow(
                        title: "App UUID",
                        subtitle: model.appUUIDDisplayText,
                        systemImage: "number.square.fill",
                        isSelected: true,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        Button {
                            model.copyAppUUID()
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: "Copy UUID",
                                systemImage: "doc.on.doc",
                                tint: SlateTheme.textPrimary,
                                highlighted: true,
                                density: density
                            )
                        }
                        .buttonStyle(.plain)
                    }

                        // Website User ID row removed

                    SlateRow(
                        title: "MacClipper Pro",
                        subtitle: model.hasUnlocked4KPro ? "Purchased" : "Buy once on the website",
                        systemImage: model.hasUnlocked4KPro ? "checkmark.seal.fill" : "lock.fill",
                        isSelected: model.hasUnlocked4KPro,
                        tint: model.hasUnlocked4KPro ? SlateTheme.success : SlateTheme.warning,
                        density: density
                    ) {
                        Button {
                            model.open4KPurchasePage()
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: model.hasUnlocked4KPro ? "Open Portal" : "Buy Pro",
                                systemImage: model.hasUnlocked4KPro ? "arrow.up.forward.app" : "cart.fill",
                                tint: SlateTheme.textPrimary,
                                highlighted: true,
                                density: density
                            )
                        }
                        .buttonStyle(.plain)
                    }

                    if !model.websiteUserID.isEmpty {
                        VStack(spacing: 0) {
                            SlatePanelDivider()
                            SlateSectionCaption(title: "Presence", density: density)

                            SlateRow(
                                title: "Status",
                                subtitle: model.userStatus.displayName,
                                systemImage: statusIcon(for: model.userStatus),
                                isSelected: true,
                                tint: statusTint(for: model.userStatus),
                                density: density
                            ) {
                                Picker("Status", selection: statusBinding) {
                                    ForEach(UserStatus.allCases) { status in
                                        HStack(spacing: 4) {
                                            Circle()
                                                .fill(statusColor(status))
                                                .frame(width: 8, height: 8)
                                            Text(status.displayName)
                                                .tag(status)
                                        }
                                    }
                                }
                                .labelsHidden()
                                .pickerStyle(.menu)
                                .tint(SlateTheme.textPrimary)
                                .frame(width: 130)
                            }
                        }
                    }

                    if model.isDeveloperBuild {
                        DeveloperSettingsPanel(density: density)
                    }

                    SlateRow(
                        title: "Shortcut",
                        subtitle: model.shortcutDisplayText,
                        systemImage: "keyboard",
                        isSelected: true,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        MenuSettingsShortcutEditor(
                            shortcutKey: shortcutKeyBinding,
                            useCommand: useCommandBinding,
                            useShift: useShiftBinding,
                            useOption: useOptionBinding,
                            useControl: useControlBinding
                        )
                    }

                    SlatePanelDivider()
                    SlateSectionCaption(title: "Audio + HUD", density: density)

                    SlateRow(
                        title: "System Audio",
                        subtitle: model.systemAudioSettingsSubtitle,
                        systemImage: "speaker.wave.3.fill",
                        isSelected: model.captureSystemAudio,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        SlateToggleButton(isOn: systemAudioBinding)
                    }

                    SlateRow(
                        title: "System Audio Level",
                        subtitle: model.systemAudioLevelSubtitle,
                        systemImage: "slider.horizontal.3",
                        isSelected: model.captureSystemAudio,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        HStack(spacing: 8) {
                            Slider(value: systemAudioLevelBinding, in: 0...100, step: 5)
                                .tint(SlateTheme.accent)
                                .frame(width: 120)
                                .disabled(!model.captureSystemAudio)

                            Text("\(model.systemAudioLevelPercent)%")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(model.captureSystemAudio ? SlateTheme.textPrimary : SlateTheme.textSecondary)
                                .frame(width: 38, alignment: .trailing)
                        }
                    }

                    SlateRow(
                        title: "Microphone",
                        subtitle: model.microphoneSettingsSubtitle,
                        systemImage: "mic.fill",
                        isSelected: model.includeMicrophone,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        SlateToggleButton(isOn: microphoneBinding)
                    }

                    SlateRow(
                        title: "Microphone Level",
                        subtitle: model.microphoneAudioLevelSubtitle,
                        systemImage: "waveform",
                        isSelected: model.includeMicrophone,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        HStack(spacing: 8) {
                            Slider(value: microphoneAudioLevelBinding, in: 0...200, step: 5)
                                .tint(SlateTheme.accent)
                                .frame(width: 120)
                                .disabled(!model.includeMicrophone)

                            Text("\(model.microphoneAudioLevelPercent)%")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(model.includeMicrophone ? SlateTheme.textPrimary : SlateTheme.textSecondary)
                                .frame(width: 38, alignment: .trailing)
                        }
                    }

                    SlateRow(
                        title: "Microphone Input",
                        subtitle: model.microphoneSelectionSubtitle,
                        systemImage: "mic",
                        isSelected: true,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        SlateFieldChrome {
                            Picker("Microphone", selection: microphoneDeviceBinding) {
                                ForEach(model.availableMicrophones) { microphone in
                                    Text(microphone.pickerLabel).tag(microphone.id)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            .tint(SlateTheme.textPrimary)
                        }
                        .frame(width: 210)
                    }

                    SlateSectionCaption(title: "Voice Commands", density: density)

                    VoiceCommandSetupCard(density: density)
                        .environmentObject(model)

                    SlateRow(
                        title: "Cursor",
                        subtitle: model.showCursor ? "Visible in clips" : "Hidden from clips",
                        systemImage: "cursorarrow",
                        isSelected: model.showCursor,
                        tint: SlateTheme.warning,
                        density: density
                    ) {
                        SlateToggleButton(isOn: showCursorBinding)
                    }

                    SlateRow(
                        title: "Notifications",
                        subtitle: model.enableGameNotifications ? "Overlay toasts enabled" : "Overlay toasts disabled",
                        systemImage: "bell.badge.fill",
                        isSelected: model.enableGameNotifications,
                        tint: SlateTheme.warning,
                        density: density
                    ) {
                        SlateToggleButton(isOn: notificationsBinding)
                    }

                    SlatePanelDivider()
                    SlateSectionCaption(title: "Share + Storage", density: density)

                    SlateRow(
                        title: "Public Posting",
                        subtitle: model.hasDiscordWebhookConfigured ? "Locked online feed ready for this build" : "Locked online feed missing",
                        systemImage: "paperplane.fill",
                        isSelected: model.hasDiscordWebhookConfigured,
                        tint: SlateTheme.accent,
                        density: density
                    ) {
                        Button {
                            model.testDiscordWebhook()
                        } label: {
                            SlateCapsuleButtonLabel(title: "Test Posting", systemImage: "arrow.triangle.2.circlepath", density: density)
                        }
                        .buttonStyle(.plain)
                    }

                    SlateRow(
                        title: "Save Folder",
                        subtitle: model.saveDirectoryPath,
                        systemImage: "folder.fill",
                        isSelected: true,
                        tint: SlateTheme.warning,
                        density: density
                    ) {
                        HStack(spacing: 6) {
                            Button {
                                model.pickSaveDirectory()
                            } label: {
                                SlateCapsuleButtonLabel(title: "Choose", systemImage: "folder.badge.plus", density: density)
                            }
                            .buttonStyle(.plain)

                            Button {
                                model.openClipsFolder()
                            } label: {
                                SlateCapsuleButtonLabel(title: "Open", systemImage: "folder", density: density)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    SlatePanelDivider()
                    SlateSectionCaption(title: "Updates + Diagnostics", density: density)

                    SlateRow(
                        title: "Clear Cache",
                        subtitle: "Remove temp buffer files and reset upload tracking",
                        systemImage: "trash.fill",
                        isSelected: false,
                        tint: SlateTheme.warning,
                        density: density
                    ) {
                        Button {
                            model.clearAppCache()
                        } label: {
                            SlateCapsuleButtonLabel(title: "Clear Cache", systemImage: "trash", tint: SlateTheme.textPrimary, highlighted: true, density: density)
                        }
                        .buttonStyle(.plain)
                    }

                    SlateRow(
                        title: "Updater",
                        subtitle: model.updater.statusText,
                        systemImage: "arrow.triangle.2.circlepath",
                        isSelected: model.updater.availableUpdate != nil,
                        tint: SlateTheme.success,
                        density: density
                    ) {
                        HStack(spacing: 6) {
                            Button {
                                model.updater.checkForUpdates()
                            } label: {
                                SlateCapsuleButtonLabel(title: "Check", systemImage: "arrow.clockwise", density: density)
                            }
                            .buttonStyle(.plain)
                            .disabled(!model.updater.canCheckForUpdates)
                        }
                    }

                    SlateRow(
                        title: "Automatic Update Checks",
                        subtitle: "Always enabled so MacClipper keeps polling for updates in the background.",
                        systemImage: "clock.badge.checkmark",
                        isSelected: true,
                        tint: SlateTheme.success,
                        density: density
                    ) {
                        SlateStatusBadge(title: "Always On", tint: SlateTheme.success)
                    }

                    SlateRow(
                        title: "Update On App Open",
                        subtitle: "Every app launch checks for updates and brings the prompt to the front.",
                        systemImage: "arrow.up.circle.fill",
                        isSelected: true,
                        tint: SlateTheme.success,
                        density: density
                    ) {
                        SlateStatusBadge(title: "Required", tint: SlateTheme.success)
                    }

                    SlateInsetPanel {
                        DisclosureGroup(isExpanded: $diagnosticsExpanded) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(model.diagnosticsLogStatusText)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(SlateTheme.textSecondary)

                                HStack(spacing: 6) {
                                    Button {
                                        model.refreshDiagnosticsLog()
                                    } label: {
                                        SlateCapsuleButtonLabel(title: "Refresh", systemImage: "arrow.clockwise", density: density)
                                    }
                                    .buttonStyle(.plain)

                                    Button {
                                        model.copyDiagnosticsLog()
                                    } label: {
                                        SlateCapsuleButtonLabel(title: "Copy", systemImage: "doc.on.doc", density: density)
                                    }
                                    .buttonStyle(.plain)

                                    Button {
                                        model.revealDiagnosticsLog()
                                    } label: {
                                        SlateCapsuleButtonLabel(title: "Reveal", systemImage: "folder", density: density)
                                    }
                                    .buttonStyle(.plain)
                                }

                                Text(model.diagnosticsLogFilePath)
                                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                                    .foregroundStyle(SlateTheme.textTertiary)
                                    .lineLimit(2)
                            }
                            .padding(.top, 10)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Advanced Diagnostics")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(SlateTheme.textPrimary)

                                Text("Refresh, copy, or reveal the internal log without opening another window.")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(SlateTheme.textSecondary)
                            }
                        }
                    }
                }
                .padding(.trailing, 4)
            }
            .frame(height: 430)
        }
        .frame(width: 560)
        .onAppear {
            model.refreshDiagnosticsLog()
        }
        .onDisappear {
            model.savePreferences()
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button {
                onBack()
            } label: {
                SlateToolbarButtonLabel(systemImage: "chevron.left", density: density)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text("Settings")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(SlateTheme.textPrimary)

                Text("Scroll for capture, audio, share, updater, and diagnostics controls.")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            Button {
                model.refreshDiagnosticsLog()
            } label: {
                SlateToolbarButtonLabel(systemImage: "arrow.clockwise", density: density)
            }
            .buttonStyle(.plain)
        }
    }

    private func binding(for keyPath: ReferenceWritableKeyPath<AppModel, Bool>) -> Binding<Bool> {
        Binding(
            get: { model[keyPath: keyPath] },
            set: {
                model[keyPath: keyPath] = $0
                model.savePreferences()
            }
        )
    }
}

private struct VirtualAudioDeviceSetupWizard: View {
    @Binding var isPresented: Bool
    @State private var setupStatus = ""
    @State private var isSettingUp = false
    @State private var engine: AudioEngineManager?
    @State private var micVolume: Float = 1.0
    @State private var systemVolume: Float = 1.0
    @State private var micEnabled = true
    @State private var systemEnabled = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Audio Engine")
                .font(.headline)
            Text("MacClipper mixes your microphone and desktop audio in-app. No system virtual device or Audio MIDI Setup needed.")
                .font(.subheadline)

            if let engine {
                VStack(spacing: 10) {
                    GroupBox(label: Label("Microphone", systemImage: "mic.fill")) {
                        VStack(spacing: 6) {
                            Toggle("Enabled", isOn: $micEnabled)
                                .onChange(of: micEnabled) { _ in
                                    engine.toggleSource(.microphone)
                                }
                            SlateVolumeSlider(value: $micVolume, label: "Volume")
                                .onChange(of: micVolume) { v in
                                    engine.micVolume = v
                                }
                        }
                        .padding(.vertical, 4)
                    }

                    GroupBox(label: Label("Desktop Audio", systemImage: "speaker.wave.2.fill")) {
                        VStack(spacing: 6) {
                            Toggle("Enabled", isOn: $systemEnabled)
                                .onChange(of: systemEnabled) { _ in
                                    engine.toggleSource(.systemAudio)
                                }
                            SlateVolumeSlider(value: $systemVolume, label: "Volume")
                                .onChange(of: systemVolume) { v in
                                    engine.systemVolume = v
                                }
                        }
                        .padding(.vertical, 4)
                    }
                }
                .font(.system(size: 12))

                VStack(spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("Audio engine is running")
                            .font(.system(size: 11, weight: .medium))
                    }

                    HStack(spacing: 4) {
                        let hp = AudioEngineManager.isHeadphonesOutput()
                        Image(systemName: hp ? "headphones" : "speaker.fill")
                            .foregroundStyle(.secondary)
                        Text(hp ? "Headphones detected — monitoring safe" : "Speakers active — sources start muted to prevent feedback")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.bottom, 2)
                }
                .padding(8)
                .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
            } else if isSettingUp {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.small)
                    Text(setupStatus)
                        .font(.system(size: 11, weight: .medium))
                }
                .padding(8)
                .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
            } else if !setupStatus.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(setupStatus)
                        .font(.system(size: 11, weight: .medium))
                }
                .padding(8)
                .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
            }

            VStack(spacing: 8) {
                if engine == nil {
                    Button {
                        startEngine()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "waveform")
                                .font(.system(size: 11))
                            Text("Start Audio Engine")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSettingUp)
                }

                Button("Done") { isPresented = false }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding()
        .frame(width: 400)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(NSColor.windowBackgroundColor)))
        .shadow(radius: 8)
        .padding()
    }

    private func startEngine() {
        isSettingUp = true
        setupStatus = "Starting audio engine..."

        DispatchQueue.main.async {
            AudioVirtualDeviceManager.createVirtualDevice()
        }

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            if let engine = AudioVirtualDeviceManager.engineManager() {
                self.engine = engine
                micVolume = engine.micVolume
                systemVolume = engine.systemVolume
                isSettingUp = false
                setupStatus = ""
            } else {
                isSettingUp = false
                setupStatus = "Audio engine could not start."
            }
        }
    }
}

private struct SlateVolumeSlider: View {
    @Binding var value: Float
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 50, alignment: .leading)
            Slider(value: $value, in: 0...1)
                .controlSize(.small)
            Text("\(Int(value * 100))%")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 36, alignment: .trailing)
        }
    }
}

private struct MenuSettingsQualitySelector: View {
    @Binding var selection: VideoQualityPreset

    var body: some View {
        HStack(spacing: 5) {
            ForEach(VideoQualityPreset.allCases) { preset in
                Button {
                    selection = preset
                } label: {
                    Text(preset.displayName)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(SlateTheme.textPrimary)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(
                            Capsule(style: .continuous)
                                .fill(selection == preset ? SlateTheme.accentSoft : SlateTheme.control)
                        )
                        .overlay(
                            Capsule(style: .continuous)
                                .stroke(selection == preset ? SlateTheme.accent.opacity(0.44) : SlateTheme.controlBorder, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct MenuSettingsShortcutEditor: View {
    @Binding var shortcutKey: String
    @Binding var useCommand: Bool
    @Binding var useShift: Bool
    @Binding var useOption: Bool
    @Binding var useControl: Bool

    var body: some View {
        HStack(spacing: 6) {
            SlateFieldChrome {
                TextField("Key", text: $shortcutKey)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15, weight: .bold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(SlateTheme.textPrimary)
            }
            .frame(width: 56)

            HStack(spacing: 4) {
                MenuSettingsShortcutChip(title: "⌘", isOn: $useCommand)
                MenuSettingsShortcutChip(title: "⇧", isOn: $useShift)
                MenuSettingsShortcutChip(title: "⌥", isOn: $useOption)
                MenuSettingsShortcutChip(title: "⌃", isOn: $useControl)
            }
        }
    }
}

private struct MenuSettingsShortcutChip: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(SlateTheme.textPrimary)
                .frame(width: 26)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(isOn ? SlateTheme.accentSoft : SlateTheme.control)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(isOn ? SlateTheme.accent.opacity(0.42) : SlateTheme.controlBorder, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}