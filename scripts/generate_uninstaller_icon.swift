import AppKit
import Foundation

enum UninstallerIconError: Error {
    case sourceIconMissing
    case pngEncodingFailed
    case iconUtilFailed(Int32)
}

let fileManager = FileManager.default
let rootURL = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let resourcesURL = rootURL.appendingPathComponent("AppResources", isDirectory: true)
let sourceIconURL = resourcesURL.appendingPathComponent("AppIcon.icns")
let iconsetURL = resourcesURL.appendingPathComponent("MacClipperUninstaller.iconset", isDirectory: true)
let icnsURL = resourcesURL.appendingPathComponent("UninstallerIcon.icns")

try? fileManager.removeItem(at: iconsetURL)
try? fileManager.removeItem(at: icnsURL)
try fileManager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)

guard let sourceImage = NSImage(contentsOf: sourceIconURL) else {
    throw UninstallerIconError.sourceIconMissing
}

func makeIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    sourceImage.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .sourceOver, fraction: 1.0)

    let badgeSize = size * 0.36
    let badgeRect = NSRect(x: size * 0.58, y: size * 0.06, width: badgeSize, height: badgeSize)
    let badgePath = NSBezierPath(ovalIn: badgeRect)
    NSColor(calibratedRed: 0.84, green: 0.20, blue: 0.20, alpha: 0.98).setFill()
    badgePath.fill()
    NSColor.white.withAlphaComponent(0.25).setStroke()
    badgePath.lineWidth = max(1.5, size * 0.01)
    badgePath.stroke()

    let xPath = NSBezierPath()
    xPath.move(to: NSPoint(x: badgeRect.minX + badgeRect.width * 0.28, y: badgeRect.minY + badgeRect.height * 0.28))
    xPath.line(to: NSPoint(x: badgeRect.maxX - badgeRect.width * 0.28, y: badgeRect.maxY - badgeRect.height * 0.28))
    xPath.move(to: NSPoint(x: badgeRect.maxX - badgeRect.width * 0.28, y: badgeRect.minY + badgeRect.height * 0.28))
    xPath.line(to: NSPoint(x: badgeRect.minX + badgeRect.width * 0.28, y: badgeRect.maxY - badgeRect.height * 0.28))
    xPath.lineCapStyle = .round
    xPath.lineWidth = max(2.0, size * 0.05)
    NSColor.white.setStroke()
    xPath.stroke()

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
        throw UninstallerIconError.pngEncodingFailed
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
    throw UninstallerIconError.iconUtilFailed(process.terminationStatus)
}

print("Generated \(icnsURL.path)")