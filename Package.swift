// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MacClipper",
    platforms: [
        .macOS("12.3")
    ],
    products: [
        .executable(name: "MacClipper", targets: ["MacClipper"]),
        .executable(name: "MacClipperUninstaller", targets: ["MacClipperUninstaller"])
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.1")
    ],
    targets: [
        .target(
            name: "MiniCutEditor",
            swiftSettings: [
                .unsafeFlags([
                    "-Xfrontend",
                    "-strict-concurrency=minimal"
                ])
            ],
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("AppKit"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("SpriteKit")
            ]
        ),
        .executableTarget(
            name: "MacClipper",
            dependencies: [
                "MiniCutEditor",
                .product(name: "Sparkle", package: "Sparkle")
            ],
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("AVKit"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("Speech"),
                .linkedFramework("AppKit"),
                .linkedFramework("SpriteKit"),
                .linkedFramework("IOKit"),
                .linkedFramework("Carbon"),
                .unsafeFlags([
                    "-Xlinker",
                    "-rpath",
                    "-Xlinker",
                    "@executable_path/../Frameworks"
                ])
            ]
        ),
        .executableTarget(
            name: "MacClipperUninstaller",
            linkerSettings: [
                .linkedFramework("AppKit")
            ]
        )
    ]
)
