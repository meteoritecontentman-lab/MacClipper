# AudioPlugins — Virtual Audio Device Research & Integration

## Goal
Provide virtual audio input and output devices for MacClipper so users can route system audio into recordings, without requiring private Apple entitlements.

## Available Approaches (ranked)

### 1. AudioTee (Apache-2.0) — Best near-term fit
- **What**: Swift CLI tool / library using Core Audio Tap API to capture system output
- **License**: Apache-2.0 — can embed, modify, redistribute freely
- **No driver install**: Uses `AudioHardwareCreateProcessTap` (macOS 13+) and `kAudioTapUIDGenerator` — system-level taps, no kernel extensions or `.driver` bundles
- **Limitation**: Captures *output* only (loopback from a specific process or system output), not a standalone virtual *input* device. Good for "record what you hear" scenarios
- **Integration**: Add as SwiftPM dependency or copy the relevant CoreAudio tap code
- **URL**: https://github.com/bitgapp/AudioTee

### 2. BlackHole (GPL-3.0) — Most full-featured
- **What**: `AudioServerPlugIn` `.driver` bundle installed into `/Library/Audio/Plug-Ins/HAL/`
- **License**: GPL-3.0 — free to use, but *commercial license required* from Existential Audio to redistribute in a paid app
- **Apple Silicon native**: No kext, uses `AudioServerPlugIn` v1/v2
- **Requires**: Copy `.driver` bundle + restart `coreaudiod` (`sudo launchctl kickstart -kp system/com.apple.audio.coreaudiod`)
- **Integration**: Ship `.driver` in `AudioPlugins/BlackHole.driver`, install on first launch
- **URL**: https://github.com/ExistentialAudio/BlackHole

### 3. Pancake (MIT) — Framework for building custom drivers
- **What**: Swift framework that wraps `AudioServerPlugIn` driver driver lifecycle, making it easier to write custom virtual audio drivers
- **License**: MIT — free to use, modify, redistribute
- **Output**: Produces a `.driver` bundle (same as BlackHole)
- **Integration**: Use Pancake's APIs to build a minimal `MacClipperVirtualAudio.driver` that provides N input channels and N output channels
- **URL**: https://github.com/FullQueueDeveloper/Pancake

### 4. Aggregate Device API (Apple-private entitlement) — Blocked
- `AudioHardwareCreateAggregateDevice` requires entitlement `com.apple.private.audio.create-aggregate-device`
- Not available to ad-hoc / developer-signed builds — requires Apple-signed provisioning
- **Fallback**: Open Audio MIDI Setup and guide user to create a Multi-Output Device manually

### 5. Soundflower (MIT) — Deprecated
- Kext-based, no Apple Silicon support, not maintained since 2017
- **Do not use**

### 6. Loopback / iShowU Audio Capture — Commercial
- Closed-source, paid, not embeddable

## Recommendation
For **"record system audio during screen capture"**, implement AudioTee's Core Audio tap approach (no install, no entitlements, Apache-2.0).
For **"virtual input device that all apps can see"**, build a `.driver` bundle with Pancake or ship BlackHole (with commercial license).

## Current Implementation
- `AudioVirtualDeviceManager.swift` in the app tries `AudioHardwareCreateAggregateDevice` first (will fail without entitlement)
- Falls back to opening Audio MIDI Setup with step-by-step guidance for manual Multi-Output Device creation
- Future: Will attempt AudioTee-style tap for "record system audio" mode

## Directory Structure
```
AudioPlugins/
  README.md        ← This file
  Sources/         ← Future: Swift source for Pancake-based driver
  Drivers/         ← Future: bundled .driver binaries
  Scripts/         ← Future: install/uninstall helpers
```
