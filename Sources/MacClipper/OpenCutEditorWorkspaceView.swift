import AppKit
import SwiftUI
import WebKit

@MainActor
struct ReactVideoEditorWorkspaceView: View {
    @EnvironmentObject private var model: AppModel

    let clip: SavedClip

    @State private var editorURL = URL(string: "https://video.designcombo.dev/")!
    @State private var statusText = "Loading React Video Editor..."

    var body: some View {
        VStack(spacing: 14) {
            toolbar

            SlatePanel(cornerRadius: 28, padding: 12) {
                ReactVideoEditorWebView(
                    url: editorURL,
                    onLoaded: {
                        statusText = "React Video Editor is ready. Reveal the clip and drag it into the timeline."
                    },
                    onFailed: { errorText in
                        statusText = "Editor failed to load: \(errorText)"
                    }
                )
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var toolbar: some View {
        SlatePanel(cornerRadius: 28, padding: 18) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    SlateSectionCaption(title: "React Video Editor")

                    Text(clip.url.deletingPathExtension().lastPathComponent)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(SlateTheme.textPrimary)
                        .lineLimit(1)

                    Text(statusText)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                HStack(spacing: 8) {
                    Button {
                        model.revealClip(at: clip.url)
                        statusText = "Clip revealed in Finder. Drag it into React Video Editor to edit."
                    } label: {
                        SlateCapsuleButtonLabel(title: "Reveal Clip", systemImage: "folder")
                    }
                    .buttonStyle(.plain)

                    Button {
                        model.copyClipToClipboard(clip.url)
                        statusText = "Clip path copied."
                    } label: {
                        SlateCapsuleButtonLabel(title: "Copy Path", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(.plain)

                    Button {
                        model.openClip(clip)
                        statusText = "Clip opened in the default app."
                    } label: {
                        SlateCapsuleButtonLabel(title: "Preview", systemImage: "play.rectangle")
                    }
                    .buttonStyle(.plain)

                    Button {
                        model.uploadClipToCloud(clip)
                        statusText = "Creating MacClipper cloud link..."
                    } label: {
                        SlateCapsuleButtonLabel(title: "Cloud", systemImage: "cloud.fill")
                    }
                    .buttonStyle(.plain)

                    Button {
                        statusText = "Reloading React Video Editor..."
                        editorURL = reloadedEditorURL(from: editorURL)
                    } label: {
                        SlateCapsuleButtonLabel(title: "Reload", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)

                    Button {
                        NSWorkspace.shared.open(editorURL)
                    } label: {
                        SlateCapsuleButtonLabel(title: "Open in Browser", systemImage: "safari", highlighted: true)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private func reloadedEditorURL(from url: URL) -> URL {
    var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    var queryItems = components?.queryItems ?? []
    queryItems.removeAll { $0.name == "reload" }
    queryItems.append(URLQueryItem(name: "reload", value: UUID().uuidString))
    components?.queryItems = queryItems
    return components?.url ?? url
}

private struct ReactVideoEditorWebView: NSViewRepresentable {
    let url: URL
    let onLoaded: () -> Void
    let onFailed: (String) -> Void

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = context.coordinator

        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        guard nsView.url != url else { return }
        nsView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoaded: onLoaded, onFailed: onFailed)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let onLoaded: () -> Void
        private let onFailed: (String) -> Void

        init(onLoaded: @escaping () -> Void, onFailed: @escaping (String) -> Void) {
            self.onLoaded = onLoaded
            self.onFailed = onFailed
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onLoaded()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onFailed(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            onFailed(error.localizedDescription)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            onFailed("Web content process terminated.")
        }
    }
}
