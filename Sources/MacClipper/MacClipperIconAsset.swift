import AppKit
import Foundation
import UniformTypeIdentifiers
import UserNotifications

@MainActor
enum MacClipperIconAsset {
    private static let attachmentFileName = "macclipper-notification-icon.png"

    static func image(size: CGFloat? = nil) -> NSImage? {
        let sourceImage: NSImage?
        if let iconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let image = NSImage(contentsOf: iconURL) {
            sourceImage = image
        } else {
            sourceImage = NSApplication.shared.applicationIconImage
        }

        guard let sourceImage else { return nil }

        let outputImage: NSImage
        if let copiedImage = sourceImage.copy() as? NSImage {
            outputImage = copiedImage
        } else {
            outputImage = sourceImage
        }

        if let size {
            outputImage.size = NSSize(width: size, height: size)
        }

        return outputImage
    }

    static func notificationAttachment() -> UNNotificationAttachment? {
        guard let fileURL = ensureAttachmentFileURL() else { return nil }
        return try? UNNotificationAttachment(
            identifier: "macclipper-app-icon",
            url: fileURL,
            options: [UNNotificationAttachmentOptionsTypeHintKey: UTType.png.identifier]
        )
    }

    private static func ensureAttachmentFileURL() -> URL? {
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(attachmentFileName, isDirectory: false)
        if FileManager.default.fileExists(atPath: fileURL.path) {
            return fileURL
        }

        guard let image = image(size: 256),
              let pngData = pngData(from: image) else {
            return nil
        }

        do {
            try pngData.write(to: fileURL, options: .atomic)
            return fileURL
        } catch {
            NSLog("MacClipper notification icon write failed: \(error.localizedDescription)")
            return nil
        }
    }

    private static func pngData(from image: NSImage) -> Data? {
        let imageSize = image.size.width > 0 && image.size.height > 0
            ? image.size
            : NSSize(width: 256, height: 256)

        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(imageSize.width),
            pixelsHigh: Int(imageSize.height),
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else {
            return nil
        }

        bitmap.size = imageSize

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        image.draw(in: NSRect(origin: .zero, size: imageSize))
        NSGraphicsContext.restoreGraphicsState()

        return bitmap.representation(using: .png, properties: [:])
    }
}