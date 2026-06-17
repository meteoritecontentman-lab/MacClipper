import AppKit
import Foundation

enum DevIconError: Error {
    case sourceIconMissing
    case pngEncodingFailed
    case iconUtilFailed(Int32)
}

let fileManager = FileManager.default
let rootURL = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let resourcesURL = rootURL.appendingPathComponent("AppResources", isDirectory: true)
let sourceIconURL = resourcesURL.appendingPathComponent("AppIcon.icns")
let iconsetURL = resourcesURL.appendingPathComponent("MacClipperDev.iconset", isDirectory: true)
let icnsURL = resourcesURL.appendingPathComponent("DevAppIcon.icns")

try? fileManager.removeItem(at: iconsetURL)
try? fileManager.removeItem(at: icnsURL)
try fileManager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)

guard let sourceImage = NSImage(contentsOf: sourceIconURL) else {
    throw DevIconError.sourceIconMissing
}

func makeIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    sourceImage.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .sourceOver, fraction: 1.0)

    let badgeSize = size * 0.36
    let badgeRect = NSRect(x: size * 0.58, y: size * 0.06, width: badgeSize, height: badgeSize)
    let badgePath = NSBezierPath(ovalIn: badgeRect)
    NSColor(calibratedRed: 0.09, green: 0.12, blue: 0.16, alpha: 0.92).setFill()
    badgePath.fill()
    NSColor.white.withAlphaComponent(0.25).setStroke()
    badgePath.lineWidth = max(1.5, size * 0.01)
    badgePath.stroke()

    // Hammer handle
    let handleRect = NSRect(
        x: badgeRect.minX + badgeRect.width * 0.44,
        y: badgeRect.minY + badgeRect.height * 0.18,
        width: badgeRect.width * 0.12,
        height: badgeRect.height * 0.50
    )
    let handle = NSBezierPath(roundedRect: handleRect, xRadius: badgeRect.width * 0.05, yRadius: badgeRect.width * 0.05)
    var hammerTransform = AffineTransform()
    hammerTransform.translate(x: badgeRect.midX, y: badgeRect.midY)
    hammerTransform.rotate(byDegrees: -35)
    hammerTransform.translate(x: -badgeRect.midX, y: -badgeRect.midY)
    handle.transform(using: hammerTransform)
    NSColor(calibratedRed: 0.91, green: 0.79, blue: 0.55, alpha: 1.0).setFill()
    handle.fill()

    // Hammer head
    let headRect = NSRect(
        x: badgeRect.minX + badgeRect.width * 0.30,
        y: badgeRect.minY + badgeRect.height * 0.53,
        width: badgeRect.width * 0.42,
        height: badgeRect.height * 0.16
    )
    let head = NSBezierPath(roundedRect: headRect, xRadius: badgeRect.width * 0.08, yRadius: badgeRect.width * 0.08)
    head.transform(using: hammerTransform)
    NSColor(calibratedRed: 0.86, green: 0.42, blue: 0.24, alpha: 1.0).setFill()
    head.fill()

    image.unlockFocus()
    return image
}

func writePNG(named name: String, size: CGFloat) throws {
    let image = makeIcon(size: size)
    guard
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let pngData = rep.representation(using: .png, properties: [:])
    else {
        throw DevIconError.pngEncodingFailed
    }

    try pngData.write(to: iconsetURL.appendingPathComponent(name))
}

let iconSizes: [(String, CGFloat)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024)
]

for (name, size) in iconSizes {
    try writePNG(named: name, size: size)
}

let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconsetURL.path, "-o", icnsURL.path]
try process.run()
process.waitUntilExit()

guard process.terminationStatus == 0 else {
    throw DevIconError.iconUtilFailed(process.terminationStatus)
}

print("Generated \(icnsURL.path)")
