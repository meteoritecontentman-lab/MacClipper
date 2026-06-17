import Foundation

struct DeveloperAdminAccountSummary: Decodable {
    let id: String
    let appUuid: String
    let displayName: String
    let email: String
    let accountStatus: String
    let subscriptionTier: String
    let paidFeatures: [String]
    let discordUserId: String
    let discordUsername: String
}

struct DeveloperTrackedInstallation: Decodable {
    let id: String
    let appUuid: String
    let machineIdentifier: String
    let machineName: String
    let machineModel: String
    let systemVersion: String
    let appVersion: String
    let buildVersion: String
    let role: String
    let accountStatus: String
    let subscriptionTier: String
    let paidFeatures: [String]
    let discordUserId: String
    let discordUsername: String
    let createdAt: String
    let updatedAt: String
    let lastSeenAt: String
}

struct DeveloperInstallationSummary: Decodable, Identifiable {
    let installation: DeveloperTrackedInstallation
    let linkedUser: DeveloperAdminAccountSummary?
    let effectiveAccountStatus: String
    let effectiveSubscriptionTier: String
    let effectivePaidFeatures: [String]
    let hasPro: Bool

    var id: String {
        installation.appUuid
    }
}

enum DeveloperAdminClientError: LocalizedError {
    case invalidBaseURL
    case missingAccessToken
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "MacClipper could not build the Firebase admin API URL."
        case .missingAccessToken:
            return "Enter a developer access token first."
        case .invalidResponse:
            return "Firebase returned an unexpected response."
        case .server(let message):
            return message
        }
    }
}

private struct DeveloperSessionValidationResponse: Decodable {
    let ok: Bool
}

private struct DeveloperInstallationsResponse: Decodable {
    let installations: [DeveloperInstallationSummary]
}

private struct DeveloperErrorResponse: Decodable {
    let error: String?
    let message: String?
}

enum DeveloperAdminClient {
    static func validateSession(apiBaseURL: URL, accessToken: String) async throws {
        let token = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            throw DeveloperAdminClientError.missingAccessToken
        }

        let request = try authorizedRequest(
            apiBaseURL: apiBaseURL,
            accessToken: token,
            path: "bot/session/validate",
            method: "GET"
        )
        let response: DeveloperSessionValidationResponse = try await perform(request)
        guard response.ok else {
            throw DeveloperAdminClientError.invalidResponse
        }
    }

    static func listInstallations(apiBaseURL: URL, accessToken: String, limit: Int = 100) async throws -> [DeveloperInstallationSummary] {
        var request = try authorizedRequest(
            apiBaseURL: apiBaseURL,
            accessToken: accessToken,
            path: "bot/installations",
            method: "GET"
        )

        if var components = URLComponents(url: request.url ?? apiBaseURL, resolvingAgainstBaseURL: false) {
            components.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
            request.url = components.url
        }

        let response: DeveloperInstallationsResponse = try await perform(request)
        return response.installations
    }

    private static func authorizedJSONRequest(
        apiBaseURL: URL,
        accessToken: String,
        path: String,
        jsonObject: [String: String]
    ) throws -> URLRequest {
        var request = try authorizedRequest(apiBaseURL: apiBaseURL, accessToken: accessToken, path: path, method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: jsonObject)
        return request
    }

    private static func authorizedRequest(apiBaseURL: URL, accessToken: String, path: String, method: String) throws -> URLRequest {
        let token = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            throw DeveloperAdminClientError.missingAccessToken
        }

        let url = apiBaseURL.appendingPathComponent(path, isDirectory: false)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10
        return request
    }

    private static func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DeveloperAdminClientError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let payload = try? JSONDecoder().decode(DeveloperErrorResponse.self, from: data) {
                throw DeveloperAdminClientError.server(payload.message ?? payload.error ?? "Firebase admin request failed.")
            }

            throw DeveloperAdminClientError.server("Firebase admin request failed with HTTP \(httpResponse.statusCode).")
        }

        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw DeveloperAdminClientError.invalidResponse
        }
    }
}