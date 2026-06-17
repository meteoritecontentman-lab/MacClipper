import AppKit
import MiniCutEditor
import SwiftUI

@MainActor
struct MiniCutEditorWorkspaceView: View {
    @EnvironmentObject private var model: AppModel

    let clip: SavedClip
    @ObservedObject var session: MiniCutEditorSession

    @State private var exportOptions = MiniCutExportOptions()
    @State private var isShowingAdvancedExport = false
    @State private var isShowingCloudShare = false
    @State private var isExporting = false
    @State private var isSharingToCloud = false
    @State private var exportErrorMessage: String?
    @State private var cloudShareErrorMessage: String?
    @State private var cloudShareURL: URL?
    @State private var shouldPromptToCopyCloudShareLink = false

    private let cloudShareClient = ClipCloudShareClient()

    var body: some View {
        VStack(spacing: 14) {
            toolbar

            SlatePanel(cornerRadius: 28, padding: 12) {
                ZStack {
                    MiniCutEditorCanvas(session: session)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )

                    if isExporting || isSharingToCloud {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color.black.opacity(0.54))

                        VStack(spacing: 10) {
                            ProgressView()
                                .controlSize(.large)

                            Text(isSharingToCloud ? "Uploading \(session.clipName)" : "Exporting \(session.clipName)")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(SlateTheme.textPrimary)

                            Text(isSharingToCloud ? "MacClipper is exporting your edit and creating a share link." : "MacClipper is building your edited clip now.")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(SlateTheme.textSecondary)
                        }
                        .padding(22)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(SlateTheme.panel)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(SlateTheme.panelBorder, lineWidth: 1)
                        )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sheet(isPresented: $isShowingAdvancedExport) {
            advancedExportSheet
        }
        .sheet(isPresented: $isShowingCloudShare) {
            cloudShareSheet
        }
        .alert("Export Failed", isPresented: exportErrorBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(exportErrorMessage ?? "MacClipper could not export this clip.")
        }
        .onAppear {
            openRequestedCloudShareSheetIfNeeded()
        }
        .onChange(of: model.pendingEditorCloudShareClipURL) { _ in
            openRequestedCloudShareSheetIfNeeded()
        }
    }

    private var toolbar: some View {
        SlatePanel(cornerRadius: 28, padding: 18) {
            HStack(alignment: .top, spacing: 16) {
                HStack(alignment: .center, spacing: 14) {
                    if let icon = MacClipperIconAsset.image(size: 46) {
                        Image(nsImage: icon)
                            .resizable()
                            .frame(width: 46, height: 46)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
                            )
                    } else {
                        SlateIconBadge(systemImage: "scissors", tint: SlateTheme.accent)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        SlateSectionCaption(title: model.clipEditorPresentationMode == .cloudShare ? "Cloud Share" : "MacClipper Editor")

                        Text(model.clipEditorPresentationMode == .cloudShare ? "MacClipper Cloud Share" : "MacClipper Editor")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(SlateTheme.textPrimary)
                            .lineLimit(1)

                        Text(editorSubtitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(SlateTheme.textSecondary)
                            .lineLimit(2)
                    }
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Output")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(SlateTheme.textTertiary)

                        Picker("Output", selection: $exportOptions.orientation) {
                            ForEach(MiniCutExportOrientation.allCases) { orientation in
                                Text(orientation.title).tag(orientation)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 250)
                    }

                    HStack(spacing: 8) {
                        Button {
                            openCloudShareSheet()
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: isSharingToCloud ? "Sharing..." : "Cloud",
                                systemImage: "cloud.fill",
                                tint: SlateTheme.textPrimary
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(isExporting || isSharingToCloud)

                        Button {
                            startExport(with: MiniCutExportOptions(orientation: exportOptions.orientation, codec: .h264))
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: isExporting ? "Exporting..." : "Export",
                                systemImage: "square.and.arrow.up.fill",
                                tint: SlateTheme.textPrimary,
                                highlighted: true
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(isExporting || isSharingToCloud)

                        Button {
                            isShowingAdvancedExport = true
                        } label: {
                            SlateCapsuleButtonLabel(
                                title: "Advanced Export",
                                systemImage: "slider.horizontal.3",
                                tint: SlateTheme.textPrimary
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(isExporting || isSharingToCloud)
                    }
                }
            }
        }
    }

    private var editorSubtitle: String {
        if model.clipEditorPresentationMode == .cloudShare {
            return "Preparing \(session.clipName) for MacClipper Cloud. \(session.statusText)"
        }

        return "Editing \(session.clipName). \(session.statusText)"
    }

    private var advancedExportSheet: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                if let icon = MacClipperIconAsset.image(size: 38) {
                    Image(nsImage: icon)
                        .resizable()
                        .frame(width: 38, height: 38)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Advanced Export")
                        .font(.system(size: 20, weight: .bold))

                    Text("Choose the output shape and codec for \(session.clipName).")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Orientation")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.secondary)

                Picker("Orientation", selection: $exportOptions.orientation) {
                    ForEach(MiniCutExportOrientation.allCases) { orientation in
                        Text(orientation.title).tag(orientation)
                    }
                }
                .pickerStyle(.segmented)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Codec")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.secondary)

                Picker("Codec", selection: $exportOptions.codec) {
                    ForEach(MiniCutExportCodec.allCases) { codec in
                        Text(codec.title).tag(codec)
                    }
                }
                .pickerStyle(.segmented)
            }

            HStack(spacing: 10) {
                Button("Cancel") {
                    isShowingAdvancedExport = false
                }
                .keyboardShortcut(.cancelAction)

                Spacer(minLength: 0)

                Button("Export") {
                    startExport(with: exportOptions)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isExporting)
            }
        }
        .padding(22)
        .frame(width: 420)
    }

    private var cloudShareSheet: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                if let icon = MacClipperIconAsset.image(size: 38) {
                    Image(nsImage: icon)
                        .resizable()
                        .frame(width: 38, height: 38)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Cloud Share")
                        .font(.system(size: 20, weight: .bold))

                    Text("Upload the current edit, open the clip page, and choose whether to copy the link.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }

            SlatePanel(cornerRadius: 20, padding: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(session.clipName)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(SlateTheme.textPrimary)

                    Text("MacClipper exports the current timeline as an MP4, uploads it to MacClipper Cloud, opens the preview page, and offers to copy the link.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(SlateTheme.textSecondary)

                    HStack(spacing: 10) {
                        shareMetadataPill(title: "Shape", value: exportOptions.orientation.title)
                        shareMetadataPill(title: "Link", value: cloudShareURL == nil ? "Pending" : "Ready")
                    }
                }
            }

            if isSharingToCloud {
                HStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.regular)

                    Text("Exporting and uploading your clip…")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }

            if let cloudShareURL {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Preview link ready")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(SlateTheme.textPrimary)

                    Text(cloudShareURL.absoluteString)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(SlateTheme.textSecondary)
                        .textSelection(.enabled)
                }

                if shouldPromptToCopyCloudShareLink {
                    SlatePanel(cornerRadius: 18, padding: 14) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Copy the clip page link?")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(SlateTheme.textPrimary)

                            Text("MacClipper already opened the hosted page in your browser. Copy the link now if you want to drop it into chat or a server.")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(SlateTheme.textSecondary)

                            HStack(spacing: 10) {
                                Button("Not Now") {
                                    shouldPromptToCopyCloudShareLink = false
                                }

                                Button("Copy Link") {
                                    copyToPasteboard(cloudShareURL.absoluteString)
                                    shouldPromptToCopyCloudShareLink = false
                                }
                                .keyboardShortcut(.defaultAction)
                            }
                        }
                    }
                }
            }

            if let cloudShareErrorMessage {
                Text(cloudShareErrorMessage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(MacClipperTheme.ember)
            }

            HStack(spacing: 10) {
                Button(cloudShareURL == nil ? "Cancel" : "Done") {
                    isShowingCloudShare = false
                }
                .keyboardShortcut(.cancelAction)

                Spacer(minLength: 0)

                if let cloudShareURL {
                    Button("Open Preview") {
                        NSWorkspace.shared.open(cloudShareURL)
                    }

                    Button("Copy Link") {
                        copyToPasteboard(cloudShareURL.absoluteString)
                    }
                    .keyboardShortcut(.defaultAction)
                } else {
                    Button(isSharingToCloud ? "Uploading..." : "Upload and Open Page") {
                        startCloudShare()
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(isSharingToCloud)
                }
            }
        }
        .padding(22)
        .frame(width: 470)
    }

    private var exportErrorBinding: Binding<Bool> {
        Binding(
            get: { exportErrorMessage != nil },
            set: { isPresented in
                if !isPresented {
                    exportErrorMessage = nil
                }
            }
        )
    }

    private func startExport(with options: MiniCutExportOptions) {
        guard !isExporting, !isSharingToCloud, let outputURL = makeOutputURL(for: options) else { return }

        isExporting = true
        exportErrorMessage = nil

        Task {
            do {
                let exportedURL = try await session.export(to: outputURL, options: options)
                isShowingAdvancedExport = false
                NSWorkspace.shared.activateFileViewerSelecting([exportedURL])
            } catch {
                exportErrorMessage = error.localizedDescription
            }

            isExporting = false
        }
    }

    private func openCloudShareSheet() {
        cloudShareErrorMessage = nil
        cloudShareURL = nil
        shouldPromptToCopyCloudShareLink = false
        isShowingCloudShare = true
    }

    private func startCloudShare() {
        guard !isSharingToCloud else { return }

        isSharingToCloud = true
        cloudShareErrorMessage = nil

        let shareOptions = MiniCutExportOptions(orientation: exportOptions.orientation, codec: .h264)

        Task {
            let temporaryURL = makeTemporaryCloudExportURL()
            defer {
                try? FileManager.default.removeItem(at: temporaryURL)
            }

            do {
                let exportedURL = try await session.export(to: temporaryURL, options: shareOptions)
                let sharedURL = try await cloudShareClient.uploadClip(
                    fileURL: exportedURL,
                    clipName: session.clipName,
                    orientation: shareOptions.orientation,
                    appUUID: model.appUUID
                )
                cloudShareURL = sharedURL
                shouldPromptToCopyCloudShareLink = true
                NSWorkspace.shared.open(sharedURL)
            } catch {
                cloudShareErrorMessage = error.localizedDescription
            }

            isSharingToCloud = false
        }
    }

    private func makeTemporaryCloudExportURL() -> URL {
        let directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent("MacClipperCloudShares", isDirectory: true)
        try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        return directoryURL.appendingPathComponent("\(UUID().uuidString).mp4")
    }

    private func openRequestedCloudShareSheetIfNeeded() {
        guard model.pendingEditorCloudShareClipURL == clip.url else { return }
        model.consumePendingCloudShareRequest(for: clip.url)
        openCloudShareSheet()
    }

    private func makeOutputURL(for options: MiniCutExportOptions) -> URL? {
        let savePanel = NSSavePanel()
        savePanel.canCreateDirectories = true
        savePanel.isExtensionHidden = false
        savePanel.allowedContentTypes = options.codec.allowedContentTypes
        savePanel.nameFieldStringValue = "\(session.suggestedExportFilename).\(options.codec.preferredFilenameExtension)"

        guard savePanel.runModal() == .OK else {
            return nil
        }

        return savePanel.url
    }

    private func shareMetadataPill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(SlateTheme.textTertiary)

            Text(value)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(SlateTheme.textPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.06))
        )
    }

    private func copyToPasteboard(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }
}