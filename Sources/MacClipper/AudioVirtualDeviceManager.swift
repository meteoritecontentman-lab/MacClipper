import Foundation
import AppKit

@MainActor
enum AudioVirtualDeviceManager {
    private static var engine: AudioEngineManager?
    private static var isInitialized = false

    static func hasVirtualDevice() -> Bool {
        engine?.isRunning ?? false
    }

    static func createVirtualDevice() -> Bool {
        guard !isInitialized else { return hasVirtualDevice() }
        isInitialized = true

        let engine = AudioEngineManager()
        self.engine = engine

        Task { @MainActor in
            do {
                try await engine.start()
                NSLog("MacClipper AudioEngine started successfully")
            } catch {
                NSLog("MacClipper AudioEngine failed: \(error.localizedDescription)")
                engine.stop()
            }
        }

        return true
    }

    static func removeVirtualDevice() {
        guard engine?.isRunning == true else { return }
        engine?.stop()
        engine = nil
        isInitialized = false
    }

    static func openAudioMidiSetup() {
        let engine = AudioEngineManager()
        self.engine = engine
        Task { @MainActor in
            do {
                try await engine.start()
                NSLog("MacClipper AudioEngine started (opened from settings)")
            } catch {
                NSLog("MacClipper AudioEngine start failed: \(error.localizedDescription)")
            }
        }
    }

    static func engineManager() -> AudioEngineManager? {
        engine
    }
}
