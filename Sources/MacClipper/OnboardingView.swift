import SwiftUI
import AVFoundation
import ScreenCaptureKit
@preconcurrency import Speech

struct OnboardingView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var currentStep: OnboardingStep = .welcome
    @State private var permissionRefreshID = UUID()
    @State private var screenRecordingStatus: PermissionStatus = .pending
    @State private var microphoneStatus: PermissionStatus = .pending
    @State private var speechStatus: PermissionStatus = .pending
    @State private var accessibilityStatus: PermissionStatus = .pending

    enum OnboardingStep {
        case welcome
        case permissions
        case features
        case voiceSetup
    }

    var body: some View {
        VStack(spacing: 0) {
            // Progress indicator
            HStack(spacing: 8) {
                ForEach([OnboardingStep.welcome, .permissions, .features, .voiceSetup], id: \.self) { step in
                    Circle()
                        .fill(currentStepIndex >= stepIndex(step) ? Color.accentColor : Color.gray.opacity(0.3))
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.top, 16)
            .padding(.bottom, 8)

            SlatePanel(cornerRadius: 26, padding: 24) {
                VStack(spacing: 20) {
                    switch currentStep {
                    case .welcome:
                        welcomeStep
                    case .permissions:
                        permissionsStep
                    case .features:
                        featuresStep
                    case .voiceSetup:
                        voiceSetupStep
                    }
                }
            }
        }
        .onAppear {
            if model.hasCompletedOnboarding {
                currentStep = .permissions
            }
        }
        .onChange(of: scenePhase) { newPhase in
            guard newPhase == .active else { return }
            permissionRefreshID = UUID()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            permissionRefreshID = UUID()
        }
        .task(id: permissionRefreshID) {
            await refreshPermissionStatuses()
        }
    }

    private var currentStepIndex: Int {
        switch currentStep {
        case .welcome: return 0
        case .permissions: return 1
        case .features: return 2
        case .voiceSetup: return 3
        }
    }

    private func stepIndex(_ step: OnboardingStep) -> Int {
        switch step {
        case .welcome: return 0
        case .permissions: return 1
        case .features: return 2
        case .voiceSetup: return 3
        }
    }

    private var welcomeStep: some View {
        VStack(spacing: 16) {
            Image(systemName: "bolt.circle.fill")
                .font(.system(size: 48))
                .foregroundColor(.accentColor)

            Text("Welcome to MacClipper")
                .font(.title2)
                .fontWeight(.bold)

            Text("The ultimate screen recording and clip management tool for Mac. Let's get you set up in just a few steps.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            Spacer()

            Button("Get Started") {
                withAnimation {
                    currentStep = .permissions
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(height: 300)
    }

    private var permissionsStep: some View {
        return VStack(spacing: 16) {
            Image(systemName: "hand.raised.fill")
                .font(.system(size: 48))
                .foregroundColor(.orange)

            Text("Grant Permissions")
                .font(.title2)
                .fontWeight(.bold)

            Text("MacClipper needs a few permissions to work properly. We'll guide you through each one.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            VStack(alignment: .leading, spacing: 12) {
                PermissionRow(
                    icon: "display",
                    title: "Screen Recording",
                    description: "Required to capture your screen",
                    status: screenRecordingStatus
                ) {
                    openPermissionSettings(for: .screenRecording)
                }

                PermissionRow(
                    icon: "mic.fill",
                    title: "Microphone",
                    description: "Optional for voice recording",
                    status: microphoneStatus
                ) {
                    openPermissionSettings(for: .microphone)
                }

                PermissionRow(
                    icon: "waveform.and.mic",
                    title: "Speech Recognition",
                    description: "Required for voice commands like Mac clip that",
                    status: speechStatus
                ) {
                    openPermissionSettings(for: .speechRecognition)
                }

                PermissionRow(
                    icon: "accessibility",
                    title: "Accessibility",
                    description: "For global hotkeys and automation",
                    status: accessibilityStatus
                ) {
                    openPermissionSettings(for: .accessibility)
                }
            }
            .id(permissionRefreshID)

            if !hasGrantedAllPermissions {
                Text("Screen Recording is required. The other permissions are optional — you can enable them later in System Settings.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Spacer()

            HStack {
                Button("Skip") {
                    model.dismissLaunchSetup()
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Finish") {
                    PrivacyPermissionNavigator.requestAndOpenSettings(for: .screenRecording)
                    PrivacyPermissionNavigator.requestAndOpenSettings(for: .microphone)
                    PrivacyPermissionNavigator.requestAndOpenSettings(for: .speechRecognition)
                    PrivacyPermissionNavigator.requestAndOpenSettings(for: .accessibility)
                    model.completeOnboarding()
                }
                .buttonStyle(.borderedProminent)
                .tint(hasGrantedAllPermissions ? .accentColor : .gray.opacity(0.7))
                .disabled(!hasGrantedAllPermissions)
            }
        }
        .frame(height: 400)
    }

    private var featuresStep: some View {
        VStack(spacing: 16) {
            Image(systemName: "star.fill")
                .font(.system(size: 48))
                .foregroundColor(.yellow)

            Text("Powerful Features")
                .font(.title2)
                .fontWeight(.bold)

            Text("Discover what MacClipper can do for you:")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            VStack(alignment: .leading, spacing: 16) {
                FeatureRow(
                    icon: "bolt",
                    title: "Instant Clips",
                    description: "Capture the last 30 seconds of your screen with a hotkey"
                )

                FeatureRow(
                    icon: "scissors",
                    title: "Video Editor",
                    description: "Trim, cut, and edit your clips with professional tools"
                )

                FeatureRow(
                    icon: "mic",
                    title: "Voice Commands",
                    description: "Say 'Mac clip that' to save clips hands-free"
                )

                FeatureRow(
                    icon: "folder",
                    title: "Local Clip Library",
                    description: "Keep your saved clips organized locally on your Mac"
                )
            }

            Spacer()

            HStack {
                Button("Back") {
                    withAnimation {
                        currentStep = .permissions
                    }
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Next") {
                    withAnimation {
                        currentStep = .voiceSetup
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .frame(height: 450)
    }

    private var voiceSetupStep: some View {
        VStack(spacing: 16) {
            VoiceCommandSetupCard(density: .regular)
                .environmentObject(model)

            Spacer()

            HStack {
                Button("Back") {
                    withAnimation {
                        currentStep = .features
                    }
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Finish Setup") {
                    model.completeOnboarding()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .frame(height: 470)
    }

    // Permission checking methods
    private func refreshPermissionStatuses() async {
        let screenStatus = await Self.resolveScreenRecordingPermissionStatus()
        let microphoneStatus = Self.resolveMicrophonePermissionStatus()
        let speechStatus = Self.resolveSpeechPermissionStatus()
        let accessibilityStatus = Self.resolveAccessibilityPermissionStatus()

        self.screenRecordingStatus = screenStatus
        self.microphoneStatus = microphoneStatus
        self.speechStatus = speechStatus
        self.accessibilityStatus = accessibilityStatus
    }

    private static func resolveScreenRecordingPermissionStatus() async -> PermissionStatus {
        let preflightAllowed = await MainActor.run {
            CGPreflightScreenCaptureAccess()
        }

        if preflightAllowed {
            return .granted
        }

        do {
            let shareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            return shareableContent.displays.isEmpty ? .denied : .granted
        } catch {
            return .denied
        }
    }

    private static func resolveMicrophonePermissionStatus() -> PermissionStatus {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        switch status {
        case .authorized:
            return .granted
        case .denied, .restricted:
            return .denied
        case .notDetermined:
            return .pending
        @unknown default:
            return .pending
        }
    }

    private static func resolveSpeechPermissionStatus() -> PermissionStatus {
        let status = SFSpeechRecognizer.authorizationStatus()
        switch status {
        case .authorized:
            return .granted
        case .denied, .restricted:
            return .denied
        case .notDetermined:
            return .pending
        @unknown default:
            return .pending
        }
    }

    private static func resolveAccessibilityPermissionStatus() -> PermissionStatus {
        let trusted = AXIsProcessTrusted()
        return trusted ? .granted : .denied
    }

    private var hasGrantedAllPermissions: Bool {
        screenRecordingStatus == .granted
    }

    private func openPermissionSettings(for pane: PrivacyPermissionPane) {
        PrivacyPermissionNavigator.requestAndOpenSettings(for: pane)
    }
}

enum PermissionStatus {
    case granted
    case denied
    case pending
}

struct PermissionRow: View {
    let icon: String
    let title: String
    let description: String
    let status: PermissionStatus
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(.accentColor)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .fontWeight(.medium)
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            HStack(spacing: 10) {
                Image(systemName: statusIcon)
                    .foregroundColor(statusColor)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.secondary.opacity(0.5))
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            action?()
        }
        .help("Open System Settings")
    }

    private var statusIcon: String {
        switch status {
        case .granted:
            return "checkmark.circle.fill"
        case .denied:
            return "xmark.circle.fill"
        case .pending:
            return "questionmark.circle.fill"
        }
    }

    private var statusColor: Color {
        switch status {
        case .granted:
            return .green
        case .denied:
            return .red
        case .pending:
            return .orange
        }
    }
}

struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(.accentColor)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .fontWeight(.medium)
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 8)
    }
}