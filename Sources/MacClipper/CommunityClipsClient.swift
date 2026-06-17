import Foundation

actor CommunityClipsClient {
    static let shared = CommunityClipsClient()

    private let supabaseURL = "https://ccnuqjmqmylergzatpua.supabase.co"
    private let anonKey = "sb_publishable_Rdcitk793uU54mzZFlwc-g_Gndh-orm"

    private var baseHeaders: [String: String] {
        [
            "apikey": anonKey,
            "Authorization": "Bearer \(anonKey)",
            "Accept": "application/json"
        ]
    }

    func fetchPublicClips(search: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> [CommunityClip] {
        var components = URLComponents(string: "\(supabaseURL)/rest/v1/clips")!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "visibility", value: "eq.public"),
            URLQueryItem(name: "order", value: "created_at.desc"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)")
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "or", value: "(title.ilike.%\(search)%,description.ilike.%\(search)%,game_title.ilike.%\(search)%)"))
        }
        components.queryItems = queryItems

        var request = URLRequest(url: components.url!)
        request.allHTTPHeaderFields = baseHeaders
        request.timeoutInterval = 15

        let (data, _) = try await URLSession.shared.data(for: request)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([CommunityClip].self, from: data)
    }

    func fetchProfile(id: String) async throws -> CommunityProfile? {
        var components = URLComponents(string: "\(supabaseURL)/rest/v1/profiles")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "id", value: "eq.\(id)"),
            URLQueryItem(name: "limit", value: "1")
        ]

        var request = URLRequest(url: components.url!)
        request.allHTTPHeaderFields = baseHeaders
        request.timeoutInterval = 10

        let (data, _) = try await URLSession.shared.data(for: request)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let profiles = try decoder.decode([CommunityProfile].self, from: data)
        return profiles.first
    }

    func fetchClipsWithProfiles(search: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> [(clip: CommunityClip, profile: CommunityProfile?)] {
        let clips = try await fetchPublicClips(search: search, limit: limit, offset: offset)
        var results: [(CommunityClip, CommunityProfile?)] = []
        for clip in clips {
            let profileId = clip.owner_profile_id ?? clip.user_id
            if let profileId {
                let profile = try? await fetchProfile(id: profileId)
                results.append((clip, profile))
            } else {
                results.append((clip, nil))
            }
        }
        return results
    }

    func fetchComments(clipID: Int) async throws -> [ClipComment] {
        var components = URLComponents(string: "\(supabaseURL)/rest/v1/clip_comments")!
        components.queryItems = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "clip_id", value: "eq.\(clipID)"),
            URLQueryItem(name: "order", value: "created_at.asc"),
            URLQueryItem(name: "limit", value: "100")
        ]

        var request = URLRequest(url: components.url!)
        request.allHTTPHeaderFields = baseHeaders
        request.timeoutInterval = 10

        let (data, _) = try await URLSession.shared.data(for: request)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([ClipComment].self, from: data)
    }

    func insertComment(clipID: Int, userID: String, commenterName: String, body: String) async throws {
        var request = URLRequest(url: URL(string: "\(supabaseURL)/rest/v1/rpc/insert_clip_comment")!)
        request.httpMethod = "POST"
        request.allHTTPHeaderFields = baseHeaders
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let bodyDict: [String: Any] = [
            "p_clip_id": clipID,
            "p_user_id": userID,
            "p_commenter_name": commenterName,
            "p_body": body
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: bodyDict)
        request.timeoutInterval = 10

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw CommentError.insertFailed
        }
    }
}

enum CommentError: LocalizedError {
    case insertFailed
}
