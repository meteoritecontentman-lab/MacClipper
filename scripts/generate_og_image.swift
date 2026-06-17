#!/usr/bin/env swift
// Generates website/public/og-image.png — 1200×630 social card for Discord / Twitter embeds.
// Run from the repo root: swift scripts/generate_og_image.swift

import AppKit
import CoreGraphics

let W: CGFloat = 1200
let H: CGFloat = 630

// ── Helpers ──────────────────────────────────────────────────────────────────

func hex(_ value: UInt32, alpha: CGFloat = 1) -> NSColor {
    let r = CGFloat((value >> 16) & 0xFF) / 255
    let g = CGFloat((value >> 8)  & 0xFF) / 255
    let b = CGFloat( value        & 0xFF) / 255
    return NSColor(srgbRed: r, green: g, blue: b, alpha: alpha)
}

// ── Canvas — use NSImage so y-axis is top-down (standard AppKit) ──────────────
let image = NSImage(size: NSSize(width: W, height: H))
image.lockFocus()
guard let ctx = NSGraphicsContext.current else { exit(1) }
ctx.imageInterpolation = .high
let cg = ctx.cgContext

// ── Background gradient (top → bottom in screen space) ───────────────────────
let bgColors = [hex(0x070c10).cgColor, hex(0x0d151e).cgColor, hex(0x091118).cgColor]
let gradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: bgColors as CFArray,
    locations: [0, 0.55, 1.0]
)!
// In lockFocus, y=0 is BOTTOM. Draw from top (H) to bottom (0).
cg.drawLinearGradient(gradient,
    start: CGPoint(x: 0, y: H),
    end: CGPoint(x: W, y: 0),
    options: [])

// ── Subtle grid ───────────────────────────────────────────────────────────────
cg.setStrokeColor(hex(0xffffff, alpha: 0.03).cgColor)
cg.setLineWidth(0.5)
stride(from: CGFloat(0), through: W, by: 60).forEach { x in
    cg.move(to: CGPoint(x: x, y: 0)); cg.addLine(to: CGPoint(x: x, y: H))
}
stride(from: CGFloat(0), through: H, by: 60).forEach { y in
    cg.move(to: CGPoint(x: 0, y: y)); cg.addLine(to: CGPoint(x: W, y: y))
}
cg.strokePath()

// ── Glow blobs ────────────────────────────────────────────────────────────────
func radialGlow(cx: CGFloat, cy: CGFloat, r: CGFloat, color: CGColor, alpha: CGFloat) {
    let colors = [color.copy(alpha: alpha)!, color.copy(alpha: 0)!]
    let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                       colors: colors as CFArray, locations: [0, 1])!
    let c = CGPoint(x: cx, y: cy)
    cg.drawRadialGradient(g, startCenter: c, startRadius: 0,
                          endCenter: c, endRadius: r,
                          options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}
// blobs placed in CG y-from-bottom coords
radialGlow(cx: 950, cy: 180, r: 360, color: hex(0x0ea5e9).cgColor, alpha: 0.13)
radialGlow(cx: 200, cy: 430, r: 260, color: hex(0x10b981).cgColor, alpha: 0.10)

// ── App icon — left side, vertically centered ─────────────────────────────────
let scriptDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let repoRoot  = scriptDir.deletingLastPathComponent()
let iconURL   = repoRoot.appendingPathComponent("AppResources/MacClipper.iconset/icon_512x512.png")

let iconSize: CGFloat = 168
let iconX: CGFloat = 72
let iconY: CGFloat = (H - iconSize) / 2   // vertically centered, CG bottom-left y

if let iconImg = NSImage(contentsOf: iconURL) {
    cg.setShadow(offset: CGSize(width: 0, height: -6), blur: 28,
                 color: NSColor.black.withAlphaComponent(0.6).cgColor)
    iconImg.draw(in: CGRect(x: iconX, y: iconY, width: iconSize, height: iconSize),
                 from: .zero, operation: .sourceOver, fraction: 1)
    cg.setShadow(offset: .zero, blur: 0, color: nil)
}

// ── Typography — right side, vertically centered as a block ──────────────────
// We draw using NSAttributedString. In lockFocus (y=0 at bottom), draw(at:)
// places text baseline at the given y coordinate, text draws upward.
// So we stack from bottom to top: CTA first (lowest y), badge last (highest y).

let textX: CGFloat = 286
let badgeFontH:    CGFloat = 16   // rough line heights
let titleFontH:    CGFloat = 74
let subtitleFontH: CGFloat = 28
let pillH:         CGFloat = 46
let gap1: CGFloat = 22  // badge → title
let gap2: CGFloat = 6   // title1 → title2
let gap3: CGFloat = 22  // title2 → subtitle
let gap4: CGFloat = 24  // subtitle → pill

let blockH = badgeFontH + gap1 + titleFontH + gap2 + titleFontH + gap3 + subtitleFontH + gap4 + pillH
let blockBaseY = (H - blockH) / 2  // y of CTA bottom edge (CG from-bottom)

// CTA pill
let pillY = blockBaseY
let pillW: CGFloat = 214
let pillRect = CGRect(x: textX, y: pillY, width: pillW, height: pillH)
let pillPath = CGPath(roundedRect: pillRect, cornerWidth: pillH / 2, cornerHeight: pillH / 2, transform: nil)
cg.addPath(pillPath)
cg.setFillColor(hex(0x0ea5e9).cgColor)
cg.fillPath()

let ctaAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 17, weight: .semibold),
    .foregroundColor: NSColor.white
]
NSAttributedString(string: "Free Download →", attributes: ctaAttrs)
    .draw(at: CGPoint(x: textX + 26, y: pillY + 14))

// Subtitle
let subY = pillY + pillH + gap4
let subAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 20, weight: .regular),
    .foregroundColor: hex(0xb8aead)
]
NSAttributedString(string: "Instant replay  ·  Local first  ·  4K Pro  ·  Cloud sharing",
                   attributes: subAttrs)
    .draw(at: CGPoint(x: textX, y: subY))

// Title line 2 (accent)
let t2Y = subY + subtitleFontH + gap3
let t2Attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 62, weight: .heavy),
    .foregroundColor: hex(0x38bdf8)
]
NSAttributedString(string: "done right.", attributes: t2Attrs)
    .draw(at: CGPoint(x: textX, y: t2Y))

// Title line 1
let t1Y = t2Y + titleFontH + gap2
let t1Attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 62, weight: .heavy),
    .foregroundColor: hex(0xf0e8db)
]
NSAttributedString(string: "Mac game clips,", attributes: t1Attrs)
    .draw(at: CGPoint(x: textX, y: t1Y))

// Badge
let badgeY = t1Y + titleFontH + gap1
let badgeAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
    .foregroundColor: hex(0x38bdf8),
    .kern: 2.2 as NSNumber
]
NSAttributedString(string: "MACCLIPPER.CO", attributes: badgeAttrs)
    .draw(at: CGPoint(x: textX, y: badgeY))

image.unlockFocus()

// ── Export ────────────────────────────────────────────────────────────────────
guard let tiffData = image.tiffRepresentation,
      let bitmapRep = NSBitmapImageRep(data: tiffData),
      let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
    fputs("Error: could not encode PNG\n", stderr)
    exit(1)
}

let outPath = repoRoot.appendingPathComponent("website/public/og-image.png").path
do {
    try pngData.write(to: URL(fileURLWithPath: outPath))
    print("Saved \(outPath) (\(Int(W))×\(Int(H)))")
} catch {
    fputs("Error writing: \(error)\n", stderr)
    exit(1)
}
