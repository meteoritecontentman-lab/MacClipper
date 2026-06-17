import AppKit

struct IconGenerator {
    static func generate() {
        let sizes = [
            ("AppIcon-20@2x", 40), ("AppIcon-20@3x", 60),
            ("AppIcon-29@2x", 58), ("AppIcon-29@3x", 87),
            ("AppIcon-40@2x", 80), ("AppIcon-40@3x", 120),
            ("AppIcon-60@2x", 120), ("AppIcon-60@3x", 180),
            ("AppIcon-76", 76), ("AppIcon-76@2x", 152),
            ("AppIcon-83.5@2x", 167),
            ("AppIcon-1024", 1024)
        ]

        let outputDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("AppResources/IosClipper.xcassets")

        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

        for (name, size) in sizes {
            let image = drawIcon(size: size)
            let url = outputDir.appendingPathComponent("\(name).png")
            guard let data = image.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: data),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                continue
            }
            try? png.write(to: url)
        }

        print("Generated \(sizes.count) iOS icon sizes in \(outputDir.path)")
    }

    static func drawIcon(size: Int) -> NSImage {
        let s = CGFloat(size)
        let canvas = NSImage(size: NSSize(width: s, height: s))
        canvas.lockFocus()

        let rect = NSRect(x: 0, y: 0, width: s, height: s)

        let bg = NSColor(calibratedRed: 0.1, green: 0.1, blue: 0.3, alpha: 1)
        bg.setFill()
        rect.fill()

        let clipPath = NSBezierPath(roundedRect: rect, xRadius: s * 0.22, yRadius: s * 0.22)
        clipPath.addClip()

        let gradient = NSGradient(
            colors: [
                NSColor(calibratedRed: 0.4, green: 0.2, blue: 0.9, alpha: 1),
                NSColor(calibratedRed: 0.1, green: 0.1, blue: 0.5, alpha: 1)
            ]
        )
        gradient?.draw(in: rect, angle: -45)

        let iconSize = s * 0.45
        let iconRect = NSRect(
            x: (s - iconSize) / 2,
            y: (s - iconSize) / 2 + iconSize * 0.1,
            width: iconSize,
            height: iconSize * 0.85
        )
        let iconPath = NSBezierPath(roundedRect: iconRect, xRadius: iconSize * 0.15, yRadius: iconSize * 0.15)
        NSColor.white.withAlphaComponent(0.9).setFill()
        iconPath.fill()

        let playSize = iconSize * 0.25
        let playPath = NSBezierPath()
        playPath.move(to: NSPoint(x: iconRect.midX - playSize * 0.4, y: iconRect.midY - playSize * 0.5))
        playPath.line(to: NSPoint(x: iconRect.midX - playSize * 0.4, y: iconRect.midY + playSize * 0.5))
        playPath.line(to: NSPoint(x: iconRect.midX + playSize * 0.5, y: iconRect.midY))
        playPath.close()
        NSColor(calibratedRed: 0.1, green: 0.1, blue: 0.3, alpha: 1).setFill()
        playPath.fill()

        canvas.unlockFocus()
        return canvas
    }
}

IconGenerator.generate()
