import Foundation

struct CommunityClip: Identifiable, Codable {
    let id: Int
    let content: String?
    let title: String?
    let description: String?
    let thumbnail_url: String?
    let owner_profile_id: String?
    let visibility: String?
    let game_title: String?
    let category_label: String?
    let created_at: String?
    let user_id: String?

    enum CodingKeys: String, CodingKey {
        case id, content, title, description
        case thumbnail_url, owner_profile_id, visibility
        case game_title, category_label, created_at, user_id
    }
}

struct CommunityProfile: Codable {
    let id: String
    let display_name: String?
    let avatar_url: String?
}

struct ClipComment: Identifiable, Codable {
    let id: Int
    let clip_id: Int
    let user_id: String
    let commenter_name: String?
    let body: String
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, clip_id, user_id, commenter_name, body, created_at
    }
}
