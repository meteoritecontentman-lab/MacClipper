import AppKit
import AVFoundation
@preconcurrency import Speech
import SwiftUI

struct VoiceCommandSetupCard: View {
    @EnvironmentObject private var model: AppModel

    let density: SlateDensity

    @StateObject private var microphoneTester = MicrophoneTestMonitor()
    @State private var microphonePermissionStatus = AVCaptureDevice.authorizationStatus(for: .audio)
    @State private var speechPermissionStatus = SFSpeechRecognizer.authorizationStatus()
    @State private var isRequestingMicrophonePermission = false
    @State private var isRequestingSpeechPermission = false

    init(density: SlateDensity = .regular) {
        self.density = density
    }

    private var microphoneBinding: Binding<String> {
        Binding(
            get: { model.selectedMicrophoneID },
            set: { newValue in
                model.setSelectedMicrophoneID(newValue)
                model.savePreferences()
            }
        )
    }

    private var resolvedSelectedMicrophoneID: String? {
        let trimmedID = model.selectedMicrophoneID.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedID.isEmpty ? nil : trimmedID
    }

    private var permissionsReady: Bool {
        microphonePermissionStatus == .authorized && speechPermissionStatus == .authorized
    }

    private var readinessTitle: String {
        permissionsReady ? "Voice trigger is ready" : "Finish voice trigger setup"
    }

    private var readinessSubtitle: String {
        if permissionsReady {
            return "Say \"Mac clip that\" while capture is live and MacClipper will save the last \(Int(model.clipDuration)) seconds."
        }

        var missing: [String] = []
        if microphonePermissionStatus != .authorized {
            missing.append("microphone access")
        }
        if speechPermissionStatus != .authorized {
            missing.append("speech recognition")
        }
        return "Allow \(missing.joined(separator: " and ")) so MacClipper can hear the trigger phrase."
    }

    private var microphonePermissionLineStatus: VoiceSetupPermissionStatus {
        VoiceSetupPermissionStatus(authorizationStatus: microphonePermissionStatus)
    }

    private var speechPermissionLineStatus: VoiceSetupPermissionStatus {
        VoiceSetupPermissionStatus(speechStatus: speechPermissionStatus)
    }

    private var microphoneTestButtonTitle: String {
        microphoneTester.isRunning ? "Stop Test" : "Test Mic"
    }

    private var microphoneTestButtonImage: String {
        microphoneTester.isRunning ? "stop.fill" : "waveform.and.mic"
    }

    private var microphoneCaptureNote: String {
        if model.includeMicrophone {
            return model.microphoneSettingsSubtitle
        } else {
            return "Voice trigger can still listen on a dedicated mic session even if saved clips are set to mute your microphone."
        }
    }

    private var spacing: CGFloat {
        density == .compact ? 10 : 14
    }

    var body: some View {
        SlateInsetPanel {
            VStack(alignment: .leading, spacing: spacing) {
                HStack(alignment: .top, spacing: density == .compact ? 10 : 14) {
                    SlateIconBadge(systemImage: "waveform.badge.mic", tint: SlateTheme.accent, density: density)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(readinessTitle)
                            .font(.system(size: density == .compact ? 14 : 16, weight: .bold))
                            .foregroundStyle(SlateTheme.textPrimary)

                        Text(readinessSubtitle)
                            .font(.system(size: density == .compact ? 11 : 12, weight: .medium))
                            .foregroundStyle(SlateTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 0)

                    SlateStatusBadge(
                        title: permissionsReady ? "Ready" : "Setup",
                        tint: permissionsReady ? SlateTheme.success : SlateTheme.warning
                    )
                }

                HStack(spacing: density == .compact ? 8 : 10) {
                    Text("Say")
                        .font(.system(size: density == .compact ? 11 : 12, weight: .semibold))
                        .foregroundStyle(SlateTheme.textSecondary)

                    Text("\"Mac clip that\"")
                        .font(.system(size: density == .compact ? 14 : 16, weight: .bold, design: .rounded))
                        .foregroundStyle(SlateTheme.textPrimary)
                        .padding(.horizontal, density == .compact ? 10 : 12)
                        .padding(.vertical, density == .compact ? 6 : 8)
                        .background(
                            Capsule(style: .continuous)
                                .fill(SlateTheme.accentSoft)
                        )

                    Spacer(minLength: 0)
                }

                VoiceSetupPermissionLine(
                    title: "Microphone Access",
                    detail: microphonePermissionLineStatus.detail,
                    systemImage: "mic.fill",
                    status: microphonePermissionLineStatus,
                    buttonTitle: microphonePermissionLineStatus.buttonTitle,
                    buttonImage: microphonePermissionLineStatus.buttonImage,
                    density: density,
                    isBusy: isRequestingMicrophonePermission,
                    action: handleMicrophonePermissionAction
                )

                VoiceSetupPermissionLine(
                    title: "Speech Recognition",
                    detail: speechPermissionLineStatus.detail,
                    systemImage: "waveform.and.mic",
                    status: speechPermissionLineStatus,
                    buttonTitle: speechPermissionLineStatus.buttonTitle,
                    buttonImage: speechPermissionLineStatus.buttonImage,
                    density: density,
                    isBusy: isRequestingSpeechPermission,
                    action: handleSpeechPermissionAction
                )

                SlatePanelDivider()

                VStack(alignment: .leading, spacing: density == .compact ? 8 : 10) {
                    Text("Input Device")
                        .font(.system(size: density == .compact ? 11 : 12, weight: .bold))
                        .foregroundStyle(SlateTheme.textTertiary)

                    HStack(spacing: density == .compact ? 10 : 12) {
                        SlateFieldChrome {
                            Picker("Microphone", selection: microphoneBinding) {
                                ForEach(model.availableMicrophones) { microphone in
                                    Text(microphone.pickerLabel).tag(microphone.id)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            .tint(SlateTheme.textPrimary)
                        }

                        Button(action: handleMicrophoneTestAction) {
                            SlateCapsuleButtonLabel(
                                title: microphoneTestButtonTitle,
                                systemImage: microphoneTestButtonImage,
                                highlighted: microphoneTester.isRunning,
                                density: density
                            )
                        }
                        .buttonStyle(.plain)
                    }

                    Text(model.microphoneSelectionSubtitle)
                        .font(.system(size: density == .compact ? 11 : 12, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: density == .compact ? 7 : 9) {
                    HStack(spacing: density == .compact ? 8 : 10) {
                        Text("Mic Test")
                            .font(.system(size: density == .compact ? 11 : 12, weight: .bold))
                            .foregroundStyle(SlateTheme.textTertiary)

                        if microphoneTester.isRunning {
                            SlateStatusBadge(title: "Listening", tint: SlateTheme.success)
                        }
                    }

                    SlateMeterBar(value: microphoneTester.level)
                        .frame(height: density == .compact ? 8 : 9)

                    Text(microphoneTester.statusText)
                        .font(.system(size: density == .compact ? 11 : 12, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(microphoneCaptureNote)
                    .font(.system(size: density == .compact ? 11 : 12, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onAppear(perform: refreshPermissionStatuses)
        .onDisappear {
            microphoneTester.stop()
        }
        .onChange(of: model.selectedMicrophoneID) { _ in
            guard microphoneTester.isRunning else { return }
            microphoneTester.start(preferredDeviceID: resolvedSelectedMicrophoneID)
        }
    }

    private func refreshPermissionStatuses() {
        microphonePermissionStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        speechPermissionStatus = SFSpeechRecognizer.authorizationStatus()
    }

    private func handleMicrophonePermissionAction() {
        switch microphonePermissionStatus {
        case .authorized:
            handleMicrophoneTestAction()
        case .notDetermined:
            requestMicrophonePermissionIfNeeded(startTestAfterGrant: false)
        case .denied, .restricted:
            PrivacyPermissionNavigator.openSettings(for: .microphone)
        @unknown default:
            PrivacyPermissionNavigator.openSettings(for: .microphone)
        }
    }

    private func handleSpeechPermissionAction() {
        switch speechPermissionStatus {
        case .authorized:
            break
        case .notDetermined:
            requestSpeechPermissionIfNeeded()
        case .denied, .restricted:
            PrivacyPermissionNavigator.openSettings(for: .speechRecognition)
        @unknown default:
            PrivacyPermissionNavigator.openSettings(for: .speechRecognition)
        }
    }

    private func handleMicrophoneTestAction() {
        if microphoneTester.isRunning {
            microphoneTester.stop()
            return
        }

        switch microphonePermissionStatus {
        case .authorized:
            microphoneTester.start(preferredDeviceID: resolvedSelectedMicrophoneID)
        case .notDetermined:
            requestMicrophonePermissionIfNeeded(startTestAfterGrant: true)
        case .denied, .restricted:
            PrivacyPermissionNavigator.openSettings(for: .microphone)
        @unknown default:
            PrivacyPermissionNavigator.openSettings(for: .microphone)
        }
    }

    private func requestMicrophonePermissionIfNeeded(startTestAfterGrant: Bool) {
        guard !isRequestingMicrophonePermission else { return }
        isRequestingMicrophonePermission = true

        AVCaptureDevice.requestAccess(for: .audio) { granted in
            Task { @MainActor in
                isRequestingMicrophonePermission = false
                refreshPermissionStatuses()
                model.savePreferences()

                if granted, startTestAfterGrant {
                    microphoneTester.start(preferredDeviceID: resolvedSelectedMicrophoneID)
                }

                PrivacyPermissionNavigator.openSettings(for: .microphone)
            }
        }
    }

    private func requestSpeechPermissionIfNeeded() {
        guard !isRequestingSpeechPermission else { return }
        isRequestingSpeechPermission = true

        SFSpeechRecognizer.requestAuthorization { _ in
            Task { @MainActor in
                isRequestingSpeechPermission = false
                refreshPermissionStatuses()
                model.savePreferences()
                PrivacyPermissionNavigator.openSettings(for: .speechRecognition)
            }
        }
    }
}

private struct VoiceSetupPermissionLine: View {
    let title: String
    let detail: String
    let systemImage: String
    let status: VoiceSetupPermissionStatus
    let buttonTitle: String?
    let buttonImage: String?
    let density: SlateDensity
    let isBusy: Bool
    let action: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: density == .compact ? 10 : 12) {
            SlateIconBadge(systemImage: systemImage, tint: status.tint, density: density)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: density == .compact ? 12 : 13, weight: .semibold))
                    .foregroundStyle(SlateTheme.textPrimary)

                Text(detail)
                    .font(.system(size: density == .compact ? 11 : 12, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            if let buttonTitle {
                Button(action: action) {
                    SlateCapsuleButtonLabel(
                        title: isBusy ? "Working" : buttonTitle,
                        systemImage: isBusy ? "hourglass" : buttonImage,
                        tint: SlateTheme.textPrimary,
                        highlighted: status.state != .granted,
                        density: density
                    )
                }
                .buttonStyle(.plain)
                .disabled(isBusy)
            } else {
                SlateStatusBadge(title: status.label, tint: status.tint)
            }
        }
        .padding(.horizontal, density == .compact ? 10 : 12)
        .padding(.vertical, density == .compact ? 9 : 11)
        .background(
            RoundedRectangle(cornerRadius: density == .compact ? 12 : 14, style: .continuous)
                .fill(SlateTheme.control)
        )
        .overlay(
            RoundedRectangle(cornerRadius: density == .compact ? 12 : 14, style: .continuous)
                .stroke(SlateTheme.controlBorder, lineWidth: 1)
        )
    }
}

private struct VoiceSetupPermissionStatus {
    enum State {
        case granted
        case pending
        case blocked
    }

    let state: State

    init(authorizationStatus: AVAuthorizationStatus) {
        switch authorizationStatus {
        case .authorized:
            state = .granted
        case .notDetermined:
            state = .pending
        case .denied, .restricted:
            state = .blocked
        @unknown default:
            state = .blocked
        }
    }

    init(speechStatus: SFSpeechRecognizerAuthorizationStatus) {
        switch speechStatus {
        case .authorized:
            state = .granted
        case .notDetermined:
            state = .pending
        case .denied, .restricted:
            state = .blocked
        @unknown default:
            state = .blocked
        }
    }

    var label: String {
        switch state {
        case .granted:
            return "Granted"
        case .pending:
            return "Needed"
        case .blocked:
            return "Blocked"
        }
    }

    var detail: String {
        switch state {
        case .granted:
            return "MacClipper can use this permission right now."
        case .pending:
            return "MacClipper still needs access before voice commands can work. Open System Settings and allow it there."
        case .blocked:
            return "macOS is blocking this permission. Open System Settings to enable it again."
        }
    }

    var tint: Color {
        switch state {
        case .granted:
            return SlateTheme.success
        case .pending:
            return SlateTheme.warning
        case .blocked:
            return Color(red: 0.90, green: 0.36, blue: 0.31)
        }
    }

    var buttonTitle: String? {
        switch state {
        case .granted:
            return nil
        case .pending:
            return "Open Settings"
        case .blocked:
            return "Open Settings"
        }
    }

    var buttonImage: String? {
        switch state {
        case .granted:
            return nil
        case .pending:
            return "gearshape"
        case .blocked:
            return "gearshape"
        }
    }
}