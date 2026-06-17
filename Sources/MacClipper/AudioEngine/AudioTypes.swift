import Foundation
import AVFoundation

enum AudioSourceID: String, CaseIterable, Identifiable, Sendable {
    case microphone
    case systemAudio

    var id: Self { self }

    var displayName: String {
        switch self {
        case .microphone: return "Microphone"
        case .systemAudio: return "Desktop Audio"
        }
    }

    var systemImage: String {
        switch self {
        case .microphone: return "mic.fill"
        case .systemAudio: return "speaker.wave.2.fill"
        }
    }
}

enum AudioSourceState: Sendable {
    case idle
    case starting
    case active
    case failed(String)
}

struct AudioSourceConfig: Sendable {
    var enabled: Bool
    var volume: Float
    var pan: Float
    var muted: Bool

    static let `default` = AudioSourceConfig(enabled: true, volume: 0.0, pan: 0.0, muted: false)
}

@MainActor
protocol AudioSource: AnyObject {
    var id: AudioSourceID { get }
    var state: AudioSourceState { get }
    var config: AudioSourceConfig { get set }
    func start() async throws
    func stop()
}
