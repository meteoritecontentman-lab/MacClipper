import Foundation
import CryptoKit

enum PaidFeatureKey: String, CaseIterable, Codable {
    case fourKPro = "4k-pro"

    var displayName: String {
        switch self {
        case .fourKPro:
            return "4K Pro"
        }
    }
}

enum FeatureActivationManager {
    static func normalizedUserID(_ userID: String) -> String {
        userID.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func normalizedFeature(_ feature: String) -> String {
        feature.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    static func normalizedFeatures(_ features: [String]) -> [String] {
        Array(
            Set(features.map(normalizedFeature).filter { !$0.isEmpty })
        )
        .sorted()
    }

    static func featureDisplayName(_ feature: String) -> String {
        if let knownFeature = PaidFeatureKey(rawValue: normalizedFeature(feature)) {
            return knownFeature.displayName
        }

        return normalizedFeature(feature)
            .split(separator: "-")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    static func verifyEntitlementHMAC(payload: Data, signature: String, machineIdentifier: String) -> Bool {
        let keyData = Data("\(machineIdentifier)-macclipper-entitlement-salt".utf8)
        let key = SymmetricKey(data: keyData)
        let expectedCode = HMAC<SHA256>.authenticationCode(for: payload, using: key)
        let expectedString = Data(expectedCode).map { String(format: "%02x", $0) }.joined()
        return signature == expectedString
    }

    static func computeEntitlementHMAC(payload: Data, machineIdentifier: String) -> String {
        let keyData = Data("\(machineIdentifier)-macclipper-entitlement-salt".utf8)
        let key = SymmetricKey(data: keyData)
        let code = HMAC<SHA256>.authenticationCode(for: payload, using: key)
        return Data(code).map { String(format: "%02x", $0) }.joined()
    }
}