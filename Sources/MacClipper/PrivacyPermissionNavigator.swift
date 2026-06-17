import AppKit
import AVFoundation
import ApplicationServices
import CoreGraphics
@preconcurrency import Speech

enum PrivacyPermissionPane {
    case screenRecording
    case microphone
    case speechRecognition
    case accessibility

    var modernSettingsURLString: String {
        switch self {
        case .screenRecording:
            return "x-apple.systemsettings:com.apple.settings.PrivacySecurity.bypass?Privacy_ScreenCapture"
        case .microphone:
            return "x-apple.systemsettings:com.apple.settings.PrivacySecurity.bypass?Privacy_Microphone"
        case .speechRecognition:
            return "x-apple.systemsettings:com.apple.settings.PrivacySecurity.bypass?Privacy_SpeechRecognition"
        case .accessibility:
            return "x-apple.systemsettings:com.apple.settings.PrivacySecurity.bypass?Privacy_Accessibility"
        }
    }

    var legacySettingsURLString: String {
        switch self {
        case .screenRecording:
            return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        case .microphone:
            return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        case .speechRecognition:
            return "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
        case .accessibility:
            return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
    }
}

@MainActor
enum PrivacyPermissionNavigator {
    static func requestAndOpenSettings(for pane: PrivacyPermissionPane) {
        switch pane {
        case .screenRecording:
            _ = CGRequestScreenCaptureAccess()
            openSettings(for: pane)
        case .microphone:
            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            if status == .notDetermined {
                AVCaptureDevice.requestAccess(for: .audio) { _ in }
            }
            openSettings(for: pane)
        case .speechRecognition:
            let status = SFSpeechRecognizer.authorizationStatus()
            if status == .notDetermined {
                SFSpeechRecognizer.requestAuthorization { _ in }
            }
            openSettings(for: pane)
        case .accessibility:
            let promptKey = "AXTrustedCheckOptionPrompt"
            _ = AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
            openSettings(for: pane)
        }
    }

    static func openSettings(for pane: PrivacyPermissionPane) {
        let urls = [
            pane.modernSettingsURLString,
            pane.legacySettingsURLString
        ].compactMap { URL(string: $0) }

        for url in urls {
            guard NSWorkspace.shared.urlForApplication(toOpen: url) != nil else { continue }
            if NSWorkspace.shared.open(url) {
                return
            }
        }

        if let fallback = URL(string: "x-apple.systempreferences:com.apple.preference.security"),
           NSWorkspace.shared.urlForApplication(toOpen: fallback) != nil {
            _ = NSWorkspace.shared.open(fallback)
        }
    }
}
