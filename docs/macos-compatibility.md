# macOS Compatibility

## Current verified state

MacClipper now declares macOS 12.3 as its build and bundle floor.

This compatibility pass verified:

- `swift build` succeeds at the current floor.
- `./scripts/package_app.sh` succeeds and rebuilds the packaged app and DMG.

Runtime QA on real macOS 12.3, macOS 13, macOS 14, macOS 15, and Intel hardware is still pending. This pass validated code paths and packaged builds, not live OS-specific recording behavior.

## Feature matrix by OS family

### macOS 15+

- Primary recorder path uses ScreenCaptureKit for screen, system audio, and microphone capture.
- Voice trigger can reuse the live recorder microphone feed.
- Full current feature set is expected on the primary capture path.

### macOS 13-14

- Primary recorder path stays on ScreenCaptureKit for screen and system audio capture.
- Microphone capture is preserved by attaching a separate AVFoundation microphone session beside the ScreenCaptureKit stream.
- Voice trigger still receives the live recorder microphone feed from that auxiliary microphone path.
- This avoids the old behavior where enabling microphone on older supported systems forced the whole recorder onto AVFoundation and dropped system audio.

### Emergency compatibility fallback on supported macOS versions

- If the primary ScreenCaptureKit path starts but never produces an initial screen frame, the recorder still falls back to the existing AVFoundation compatibility backend.
- That emergency fallback preserves screen recording and optional microphone capture.
- System audio is still unavailable in that emergency fallback backend.

## What blocks going below macOS 13 without removing features

## Real framework floor

ScreenCaptureKit itself starts at macOS 12.3 according to Apple documentation.

That means:

- Full-feature support below macOS 12.3 is not realistic with the current architecture.
- The current ScreenCaptureKit-based system-audio path cannot exist on macOS 12.0-12.2 or macOS 11.

## Hard blockers below macOS 12.3

- `Sources/MacClipper/ReplayBufferRecorder.swift` imports and relies on ScreenCaptureKit as the primary recorder pipeline.
- `Sources/MacClipper/OnboardingView.swift` uses `SCShareableContent` to probe screen-capture availability.
- Preserving screen capture plus system audio below macOS 12.3 would require replacing ScreenCaptureKit with a different capture architecture.
- AVFoundation already exists as a fallback, but it does not provide the same system-audio capture capability.

## Remaining realities at the macOS 12.3 floor

The declared app floor is now macOS 12.3, matching the real ScreenCaptureKit floor.

What still matters:

- macOS 12.3-12.x should use the macOS 12 clip-library fallback layout instead of the newer `NavigationSplitView` path.
- Full compatibility still needs runtime QA on real Intel and Apple Silicon Macs across supported OS versions.
- Support below macOS 12.3 is still blocked by ScreenCaptureKit-based capture.

## Non-blockers already handled in code

- Microphone capture on pre-macOS 15 ScreenCaptureKit runs is now handled by a separate AVFoundation microphone session instead of disabling system audio.
- Carbon global hotkeys remain compatible with much older macOS versions.
- AVFoundation microphone capture remains available on older systems.
- Speech authorization and recorder-fed voice-command plumbing remain in place; no compatibility blocker was identified there during this pass.

## Recommended next step

If the goal is to broaden support without removing features, macOS 12.3 is the realistic floor, not macOS 11 or older.

The next step is runtime QA on real 12.3+ machines before claiming broad support across old Intel MacBooks, Apple Silicon, and newer Sequoia systems.