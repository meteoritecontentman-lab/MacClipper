import SwiftUI
import AppKit

struct ClipEditorWindowView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var sessionStore = MiniCutEditorSessionStore()

    private var activeClip: SavedClip? {
        model.editingClip ?? model.clipBeingEdited ?? model.selectedClip ?? model.clips.first
    }

    var body: some View {
        ZStack {
            MacClipperBackdrop(style: .menuGray)

            Group {
                if model.clips.isEmpty {
                    emptyLibraryState
                } else if !model.hasUnlocked4KPro && model.clipEditorPresentationMode == .edit {
                    proLockState
                } else {
                    editorWorkspace
                }
            }
            .padding(16)
        }
        .frame(minWidth: 1480, minHeight: 920)
        .background(ClipEditorWindowConfigurator())
        .onAppear {
            model.reloadClips()
            pruneEditorSessions()
            syncEditingSelection()
        }
        .onChange(of: model.clips) { _ in
            pruneEditorSessions()
            syncEditingSelection()
        }
    }

    @ViewBuilder
    private var editorWorkspace: some View {
        if let activeClip {
            MiniCutEditorWorkspaceView(
                clip: activeClip,
                session: sessionStore.session(for: activeClip)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            SlatePanel(cornerRadius: 28, padding: 30) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("No clip selected")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(SlateTheme.textPrimary)

                    Text("Choose a clip from the library and MacClipper Editor will load it here.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    private var emptyLibraryState: some View {
        SlatePanel(cornerRadius: 28, padding: 28) {
            VStack(spacing: 16) {
                Image(systemName: "film.stack")
                    .font(.system(size: 54, weight: .semibold))
                    .foregroundStyle(SlateTheme.textTertiary)

                Text("No clips available yet")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(SlateTheme.textPrimary)

                Text("Save a clip first, then press Edit from the clip library to open it in MacClipper Editor.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)
                    .multilineTextAlignment(.center)

                Button {
                    model.reloadClips()
                } label: {
                    SlateCapsuleButtonLabel(title: "Refresh Library", systemImage: "arrow.clockwise", highlighted: true)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var proLockState: some View {
        SlatePanel(cornerRadius: 28, padding: 28) {
            VStack(spacing: 18) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 56, weight: .semibold))
                    .foregroundStyle(SlateTheme.textTertiary)

                Text("MacClipper PRO required")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(SlateTheme.textPrimary)

                Text("MacClipper Editor is part of MacClipper PRO.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(SlateTheme.textSecondary)

                Button {
                    model.open4KPurchasePage()
                } label: {
                    SlateCapsuleButtonLabel(title: "Unlock PRO", systemImage: "star.fill", highlighted: true)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func selectClipForEditing(_ clip: SavedClip) {
        model.selectedClip = clip
        model.clipBeingEdited = clip
        model.editingClip = clip
    }

    private func syncEditingSelection() {
        guard !model.clips.isEmpty else { return }

        if let currentClip = activeClip,
           let matchedClip = model.clips.first(where: { $0.id == currentClip.id }) {
            selectClipForEditing(matchedClip)
            return
        }

        if let firstClip = model.clips.first {
            selectClipForEditing(firstClip)
        }
    }

    private func pruneEditorSessions() {
        sessionStore.removeSessions(except: Set(model.clips.map(\.url)))
    }
}

private struct ClipEditorWindowConfigurator: NSViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = nsView.window else { return }

            window.title = "MacClipper Editor"
            window.minSize = NSSize(width: 1480, height: 920)
            window.tabbingMode = .disallowed
            NSApp.activate(ignoringOtherApps: true)

            guard !context.coordinator.didConfigureInitialPresentation else { return }
            context.coordinator.didConfigureInitialPresentation = true

            if let screenFrame = window.screen?.visibleFrame {
                let targetWidth = min(max(screenFrame.width * 0.94, 1480), screenFrame.width)
                let targetHeight = min(max(screenFrame.height * 0.92, 920), screenFrame.height)
                let frame = NSRect(
                    x: screenFrame.midX - targetWidth / 2,
                    y: screenFrame.midY - targetHeight / 2,
                    width: targetWidth,
                    height: targetHeight
                )
                window.setFrame(frame, display: true)
            }
        }
    }

    final class Coordinator {
        var didConfigureInitialPresentation = false
    }
}
