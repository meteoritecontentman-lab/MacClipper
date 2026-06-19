import Foundation

enum UserStatus: String, Codable, CaseIterable, Identifiable {
    case online
    case idle
    case dnd = "do_not_disturb"
    case offline

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .online: return "Online"
        case .idle: return "Idle"
        case .dnd: return "Do Not Disturb"
        case .offline: return "Offline"
        }
    }

    var color: String {
        switch self {
        case .online: return "green"
        case .idle: return "yellow"
        case .dnd: return "red"
        case .offline: return "gray"
        }
    }
}

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
    var status: UserStatus?

    enum CodingKeys: String, CodingKey {
        case id, display_name, avatar_url, status
    }

    init(id: String, display_name: String?, avatar_url: String?, status: UserStatus? = nil) {
        self.id = id
        self.display_name = display_name
        self.avatar_url = avatar_url
        self.status = status
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.display_name = try container.decodeIfPresent(String.self, forKey: .display_name)
        self.avatar_url = try container.decodeIfPresent(String.self, forKey: .avatar_url)
        self.status = try container.decodeIfPresent(UserStatus.self, forKey: .status)
    }
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
