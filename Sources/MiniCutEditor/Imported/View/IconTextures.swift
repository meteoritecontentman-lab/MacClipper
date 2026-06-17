import SpriteKit

#if canImport(AppKit)
import AppKit
#endif

@MainActor
enum IconTextures {
    static let backToStart = symbol("backward.end.fill")
    static let back = symbol("backward.fill")
    static let play = symbol("play.fill")
    static let pause = symbol("pause.fill")
    static let forward = symbol("forward.fill")
    static let skipToEnd = symbol("forward.end.fill")
    static let plus = symbol("plus")
    static let trash = symbol("trash")
    static let audio = symbol("speaker.wave.2.fill")
    static let scissors = symbol("scissors")

    private static func symbol(_ systemName: String) -> SKTexture {
        #if canImport(AppKit)
        let config = NSImage.SymbolConfiguration(pointSize: 28, weight: .bold)
        let image = NSImage(systemSymbolName: systemName, accessibilityDescription: nil)?
            .withSymbolConfiguration(config)
            ?? NSImage(size: NSSize(width: 28, height: 28))
        return SKTexture(image: image)
        #else
        return SKTexture()
        #endif
    }
}
