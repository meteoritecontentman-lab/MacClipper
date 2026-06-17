import Foundation

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
}