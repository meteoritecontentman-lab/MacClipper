import Foundation
import MiniCutEditor

@MainActor
final class MiniCutEditorSessionStore: ObservableObject {
    private var sessions: [URL: MiniCutEditorSession] = [:]

    func session(for clip: SavedClip) -> MiniCutEditorSession {
        if let existing = sessions[clip.url] {
            return existing
        }

        let session = MiniCutEditorSession(clipURL: clip.url)
        sessions[clip.url] = session
        return session
    }

    func removeSessions(except validURLs: Set<URL>) {
        sessions = sessions.filter { validURLs.contains($0.key) }
    }
}