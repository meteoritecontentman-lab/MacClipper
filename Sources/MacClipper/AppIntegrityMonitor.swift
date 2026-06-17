import Foundation
import AppKit

enum AppIntegrityMonitor {
    @MainActor private static var hasPresentedIntegrityAlert = false

    @MainActor private(set) static var isIntegrityCompromised = false

    static func verifyCurrentAppBundleAtLaunch() {
        let bundleURL = Bundle.main.bundleURL.standardizedFileURL
        guard bundleURL.pathExtension.lowercased() == "app" else { return }
        guard !bundleURL.path.contains("/.build/") else { return }

        Task.detached(priority: .utility) {
            if let failureMessage = verifyCurrentBundleIntegrity(at: bundleURL) {
                AppLogger.shared.log("Security", "app integrity verification failed message=\(failureMessage)")
                await MainActor.run {
                    isIntegrityCompromised = true
                }
            } else {
                AppLogger.shared.log("Security", "app integrity verification passed path=\(bundleURL.path)")
            }
        }
    }

    private static func verifyCurrentBundleIntegrity(at bundleURL: URL) -> String? {
        if let signatureFailure = verifyBundleSignature(at: bundleURL) {
            return signatureFailure
        }

        if let signerFailure = verifyTrustedSignerMetadata(at: bundleURL) {
            return signerFailure
        }

        return nil
    }

    private static func verifyBundleSignature(at bundleURL: URL) -> String? {
        let process = Process()
        let outputPipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        process.arguments = ["--verify", "--deep", "--strict", "--ignore-resources", bundleURL.path]
        process.standardOutput = outputPipe
        process.standardError = outputPipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return error.localizedDescription
        }

        let output = String(decoding: outputPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard process.terminationStatus == 0 else {
            return output.isEmpty ? "Code signature verification failed." : output
        }

        return nil
    }

    private static func verifyTrustedSignerMetadata(at bundleURL: URL) -> String? {
        let info = Bundle.main.infoDictionary ?? [:]
        let enforceSigner = (info["MacClipperEnforceTrustedSigner"] as? Bool) == true
        let expectedTeamID = String(describing: info["MacClipperExpectedTeamIdentifier"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let expectedBundleID = Bundle.main.bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        let isDeveloperMode = (info["MacClipperDeveloperMode"] as? Bool) == true
        if isDeveloperMode && !enforceSigner {
            return nil
        }

        let details = readCodeSignDetails(for: bundleURL.path)

        if !expectedBundleID.isEmpty,
           let actualBundleID = details["Identifier"],
           actualBundleID != expectedBundleID {
            return "Code signature identifier mismatch. Expected \(expectedBundleID) but found \(actualBundleID)."
        }

        if enforceSigner {
            guard !expectedTeamID.isEmpty else {
                return "Trusted signer enforcement is enabled, but no expected team identifier is configured."
            }

            let actualTeamID = details["TeamIdentifier"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !actualTeamID.isEmpty else {
                return "This build requires a trusted signer, but the signature is ad-hoc or missing a team identifier."
            }

            if actualTeamID != expectedTeamID {
                return "Signature team mismatch. Expected \(expectedTeamID) but found \(actualTeamID)."
            }
        }

        return nil
    }

    private static func readCodeSignDetails(for bundlePath: String) -> [String: String] {
        let process = Process()
        let outputPipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        process.arguments = ["-dv", "--verbose=4", bundlePath]
        process.standardOutput = outputPipe
        process.standardError = outputPipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return [:]
        }

        let output = String(decoding: outputPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        var parsed: [String: String] = [:]

        output
            .split(whereSeparator: \Character.isNewline)
            .forEach { line in
                let parts = line.split(separator: "=", maxSplits: 1)
                guard parts.count == 2 else { return }
                let key = String(parts[0]).trimmingCharacters(in: .whitespacesAndNewlines)
                let value = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)
                parsed[key] = value
            }

        return parsed
    }
}
