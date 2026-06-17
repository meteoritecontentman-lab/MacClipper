import SwiftUI

struct MenuClipEditorPage: View {
    @EnvironmentObject private var model: AppModel

    let onBack: () -> Void

    var body: some View {
        ZStack {
            SlatePanel(cornerRadius: 0, padding: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Button {
                            onBack()
                        } label: {
                            SlateCapsuleButtonLabel(title: "Back", systemImage: "chevron.left", density: .compact)
                        }
                        .buttonStyle(.plain)
                        Spacer(minLength: 0)
                        if let clip = model.clipBeingEdited {
                            MacClipperPill(
                                title: clip.url.deletingPathExtension().lastPathComponent,
                                systemImage: "slider.horizontal.3",
                                tint: MacClipperTheme.cyan
                            )
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 18)
                    .padding(.bottom, 8)

                    if !model.hasUnlocked4KPro {
                        VStack(spacing: 16) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 48))
                                .foregroundColor(SlateTheme.textTertiary)
                            
                            Text("PRO Feature Required")
                                .font(.system(size: 22, weight: .bold, design: .rounded))
                                .foregroundColor(SlateTheme.textPrimary)
                            
                            Text("MacClipper Editor lives in its own desktop window and requires MacClipper PRO.")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundColor(SlateTheme.textSecondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 20)
                            
                            Button(action: {
                                model.open4KPurchasePage()
                            }) {
                                Text("Unlock PRO")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 20)
                                    .padding(.vertical, 10)
                                    .background(MacClipperTheme.cyan)
                                    .cornerRadius(8)
                            }
                            .buttonStyle(.plain)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(40)
                    } else if let clip = model.clipBeingEdited ?? model.selectedClip {
                        VStack(spacing: 18) {
                            Image(systemName: "sparkles.rectangle.stack.fill")
                                .font(.system(size: 42, weight: .semibold))
                                .foregroundStyle(SlateTheme.accent)

                            Text("Desktop editor ready")
                                .font(.system(size: 24, weight: .bold, design: .rounded))
                                .foregroundStyle(SlateTheme.textPrimary)

                            Text("Open \(clip.url.deletingPathExtension().lastPathComponent) in the dedicated MacClipper Editor window to trim, stack, and export it.")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(SlateTheme.textSecondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 26)

                            HStack(spacing: 10) {
                                Button {
                                    model.openClipEditor(for: clip)
                                } label: {
                                    SlateCapsuleButtonLabel(title: "Open Editor Window", systemImage: "macwindow", tint: SlateTheme.textPrimary, highlighted: true)
                                }
                                .buttonStyle(.plain)

                                Button {
                                    onBack()
                                } label: {
                                    SlateCapsuleButtonLabel(title: "Back to Menu", systemImage: "chevron.left", tint: SlateTheme.textPrimary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(40)
                    } else {
                        VStack(spacing: 16) {
                            Text("Select a Clip to Edit")
                                .font(.system(size: 22, weight: .bold, design: .rounded))
                            
                            Text("Choose a clip from your library, then open it in the desktop editor window.")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                            
                            ScrollView {
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200))], spacing: 16) {
                                    ForEach(model.clips) { clip in
                                        ClipSelectorCard(clip: clip) {
                                            model.openClipEditor(for: clip)
                                        }
                                    }
                                }
                                .padding()
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(40)
                    }
                }
            }
        }
    }
}

struct ClipSelectorCard: View {
    let clip: SavedClip
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 12) {
                // Thumbnail
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(SlateTheme.control)
                        .aspectRatio(16/9, contentMode: .fit)
                    
                    VStack {
                        Image(systemName: "video")
                            .font(.system(size: 24))
                            .foregroundColor(SlateTheme.textSecondary)
                        
                        Text("Preview")
                            .font(.system(size: 12))
                            .foregroundColor(SlateTheme.textTertiary)
                    }
                }
                
                // Info
                VStack(alignment: .leading, spacing: 4) {
                    Text(clip.url.deletingPathExtension().lastPathComponent)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(SlateTheme.textPrimary)
                        .lineLimit(1)
                    
                    Text(clip.fileSizeText)
                        .font(.system(size: 12))
                        .foregroundColor(SlateTheme.textSecondary)
                }
            }
            .padding(16)
            .background(SlateTheme.panel)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(SlateTheme.divider, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}