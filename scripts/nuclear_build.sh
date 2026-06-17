#!/bin/zsh
set -euo pipefail

# Nuclear build script: always deletes and recreates dist, builds fresh, and fails on any error

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MacClipper"
DIST_DIR="$ROOT/dist"

# 1. Clean dist directory
if [ -d "$DIST_DIR" ]; then
    echo "[NUCLEAR] Removing old dist directory..."
    rm -rf "$DIST_DIR"
fi
mkdir -p "$DIST_DIR"
echo "[NUCLEAR] Created fresh dist directory at $DIST_DIR"

# 2. Clean build artifacts
if [ -d "$ROOT/.build" ]; then
    echo "[NUCLEAR] Removing .build directory..."
    rm -rf "$ROOT/.build"
fi

# 3. Build the app for native arch only (guaranteed to work on this machine)
ARCH="$(uname -m)"
echo "[NUCLEAR] Building for architecture: $ARCH"
cd "$ROOT"
swift build -c release --arch "$ARCH"

# 4. Find the built app binary
BUILD_DIR="$(swift build -c release --arch "$ARCH" --show-bin-path)"
APP_BINARY="$BUILD_DIR/$APP_NAME"
if [ ! -f "$APP_BINARY" ]; then
    echo "[NUCLEAR] ERROR: App binary not found at $APP_BINARY" >&2
    exit 1
fi

# 5. Create .app bundle structure
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp "$APP_BINARY" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
cp "$ROOT/AppResources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp "$ROOT/AppResources/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"

# 6. Make executable
chmod +x "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

# 7. Print result
ls -la "$DIST_DIR"
echo "[NUCLEAR] Build complete. App bundle at $APP_BUNDLE"
