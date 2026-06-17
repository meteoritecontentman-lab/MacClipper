import AppKit
import Foundation

enum AppIconError: Error {
    case sourceIconMissing
    case pngEncodingFailed
    case iconUtilFailed(Int32)
}

let fileManager = FileManager.default
let rootURL = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let resourcesURL = rootURL.appendingPathComponent("AppResources", isDirectory: true)
let sourceIconURL = resourcesURL.appendingPathComponent("DesiredIconSource.png")
let iconsetURL = resourcesURL.appendingPathComponent("MacClipper.iconset", isDirectory: true)
let icnsURL = resourcesURL.appendingPathComponent("AppIcon.icns")

try? fileManager.removeItem(at: iconsetURL)
try? fileManager.removeItem(at: icnsURL)
try fileManager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)

guard let sourceImage = NSImage(contentsOf: sourceIconURL) else {
    throw AppIconError.sourceIconMissing
}

func makeIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    sourceImage.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .sourceOver, fraction: 1.0)
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
        throw AppIconError.pngEncodingFailed
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
    throw AppIconError.iconUtilFailed(process.terminationStatus)
}

print("Generated \(icnsURL.path)")
