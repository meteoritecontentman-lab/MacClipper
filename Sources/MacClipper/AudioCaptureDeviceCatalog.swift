import AVFoundation

// List of known virtual audio device names
private let knownVirtualAudioDeviceNames: [String] = [
    "BlackHole",
    "Loopback Audio",
    "Soundflower (2ch)",
    "VB-Cable",
    "iShowU Audio Capture",
    "MacClipper Virtual Device"
]

enum AudioCaptureDeviceCatalog {
    static func devices() -> [AVCaptureDevice] {
        AVCaptureDevice.devices(for: .audio)
            .sorted { $0.localizedName.localizedCaseInsensitiveCompare($1.localizedName) == .orderedAscending }
    }
    // Returns the first detected virtual audio device, or nil if none found
    static func firstVirtualAudioDevice() -> AVCaptureDevice? {
        return devices().first(where: { device in
            knownVirtualAudioDeviceNames.contains(where: { device.localizedName.contains($0) })
        })
    }

    // Returns true if any known virtual audio device is present
    static func hasVirtualAudioDevice() -> Bool {
        return firstVirtualAudioDevice() != nil
    }

    // Returns a list of all detected virtual audio devices
    static func allVirtualAudioDevices() -> [AVCaptureDevice] {
        return devices().filter { device in
            knownVirtualAudioDeviceNames.contains(where: { device.localizedName.contains($0) })
        }
    }

    static func device(withUniqueID uniqueID: String?) -> AVCaptureDevice? {
        guard let uniqueID, !uniqueID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }

        return devices().first(where: { $0.uniqueID == uniqueID })
    }

    static func preferredDevice(preferredUniqueID: String?) -> AVCaptureDevice? {
        if let preferredDevice = device(withUniqueID: preferredUniqueID) {
            return preferredDevice
        }

        return AVCaptureDevice.default(for: .audio) ?? devices().first
    }
}