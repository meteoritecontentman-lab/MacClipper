#!/bin/zsh
set -euo pipefail

# MacClipper Distribution Build Script
# Builds .app bundles and .dmg installers for both Intel and Apple Silicon

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MacClipper"
VOL_NAME="MacClipper Installer"
DIST_DIR="$ROOT/dist"
BACKGROUND_NAME="dmg-background.png"
TARGET_ARCHS=(arm64 x86_64)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

arch_label() {
  case "$1" in
    arm64)
      echo "apple-silicon"
      ;;
    x86_64)
      echo "intel"
      ;;
    *)
      echo "$1"
      ;;
  esac
}

validate_arch() {
  case "$1" in
    arm64|x86_64)
      ;;
    *)
      log_error "Unsupported architecture '$1'. Use arm64 or x86_64."
      exit 1
      ;;
  esac
}

app_path_for_arch() {
  local arch="$1"
  echo "$DIST_DIR/$APP_NAME-$(arch_label "$arch").app"
}

dmg_path_for_arch() {
  local arch="$1"
  echo "$DIST_DIR/$APP_NAME-$(arch_label "$arch").dmg"
}

find_sparkle_framework() {
  local build_dir="$1"
  local target_arch="$2"
  local candidates=()

  if [[ -d "$build_dir/Sparkle.framework" ]]; then
    candidates+=("$build_dir/Sparkle.framework")
  fi

  if [[ -d "$ROOT/.build/$target_arch-apple-macosx/release/Sparkle.framework" ]]; then
    candidates+=("$ROOT/.build/$target_arch-apple-macosx/release/Sparkle.framework")
  fi

  if [[ -d "$ROOT/.build/release/Sparkle.framework" ]]; then
    candidates+=("$ROOT/.build/release/Sparkle.framework")
  fi

  if [[ -d "$ROOT/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework" ]]; then
    candidates+=("$ROOT/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework")
  fi

  if (( ${#candidates[@]} == 0 )); then
    local discovered
    discovered="$(find "$ROOT/.build" -path '*/Sparkle.framework' -type d | head -n 1)"
    if [[ -n "$discovered" ]]; then
      candidates+=("$discovered")
    fi
  fi

  if (( ${#candidates[@]} == 0 )); then
    log_error "Unable to locate Sparkle.framework after build."
    return 1
  fi

  printf '%s\n' "${candidates[1]}"
}

build_app_for_arch() {
  local target_arch="$1"
  local app_path="$2"

  log_info "Building $APP_NAME.app for $target_arch..."

  # Build the executable
  log_info "Building Swift executable for $target_arch..."
  BUILD_ARGS=(-c release --arch "$target_arch")
  BUILD_DIR="$(swift build "${BUILD_ARGS[@]}" --show-bin-path)"
  swift build "${BUILD_ARGS[@]}"
  EXECUTABLE="$BUILD_DIR/$APP_NAME"

  # Get bundle info
  BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ROOT/AppResources/Info.plist")"
  DEFAULT_ACCOUNT_PORTAL_URL="$(/usr/libexec/PlistBuddy -c 'Print :MacClipperAccountPortalURL' "$ROOT/AppResources/Info.plist" 2>/dev/null || true)"
  DEFAULT_API_BASE_URL="$(/usr/libexec/PlistBuddy -c 'Print :MacClipperAPIBaseURL' "$ROOT/AppResources/Info.plist" 2>/dev/null || true)"
  ACCOUNT_PORTAL_URL="${MACCLIPPER_ACCOUNT_PORTAL_URL:-}"
  API_BASE_URL="${MACCLIPPER_API_BASE_URL:-}"

  if [[ -z "$ACCOUNT_PORTAL_URL" && -n "$API_BASE_URL" ]]; then
    ACCOUNT_PORTAL_URL="${API_BASE_URL%/}/buy-4k.html"
  fi

  # Create app bundle structure
  log_info "Creating app bundle structure..."
  rm -rf "$app_path"
  mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources" "$app_path/Contents/Frameworks" "$app_path/Contents/Main-Logs"

  # Copy executable and resources
  cp "$EXECUTABLE" "$app_path/Contents/MacOS/$APP_NAME"
  cp "$ROOT/AppResources/Info.plist" "$app_path/Contents/Info.plist"
  cp "$ROOT/AppResources/AppIcon.icns" "$app_path/Contents/Resources/AppIcon.icns"
  cp "$ROOT/AppResources/Main-Logs-README.txt" "$app_path/Contents/Main-Logs/README.txt"

  # Configure account portal URL if provided
  if [[ -n "$ACCOUNT_PORTAL_URL" ]]; then
    /usr/libexec/PlistBuddy -c "Set :MacClipperAccountPortalURL $ACCOUNT_PORTAL_URL" "$app_path/Contents/Info.plist" >/dev/null 2>&1 || \
      /usr/libexec/PlistBuddy -c "Add :MacClipperAccountPortalURL string $ACCOUNT_PORTAL_URL" "$app_path/Contents/Info.plist"
    log_info "Configured MacClipperAccountPortalURL=$ACCOUNT_PORTAL_URL"
  fi

  if [[ -n "$API_BASE_URL" ]]; then
    /usr/libexec/PlistBuddy -c "Set :MacClipperAPIBaseURL $API_BASE_URL" "$app_path/Contents/Info.plist" >/dev/null 2>&1 || \
      /usr/libexec/PlistBuddy -c "Add :MacClipperAPIBaseURL string $API_BASE_URL" "$app_path/Contents/Info.plist"
    log_info "Configured MacClipperAPIBaseURL=$API_BASE_URL"
  fi

  # Check for localhost URLs
  RESOLVED_ACCOUNT_PORTAL_URL="$ACCOUNT_PORTAL_URL"
  if [[ -z "$RESOLVED_ACCOUNT_PORTAL_URL" ]]; then
    RESOLVED_ACCOUNT_PORTAL_URL="$DEFAULT_ACCOUNT_PORTAL_URL"
  fi

  if [[ -z "$API_BASE_URL" ]]; then
    API_BASE_URL="$DEFAULT_API_BASE_URL"
  fi

  if [[ "$RESOLVED_ACCOUNT_PORTAL_URL" == http://127.0.0.1:* || "$RESOLVED_ACCOUNT_PORTAL_URL" == https://127.0.0.1:* || "$RESOLVED_ACCOUNT_PORTAL_URL" == http://localhost:* || "$RESOLVED_ACCOUNT_PORTAL_URL" == https://localhost:* ]]; then
    log_warning "MacClipperAccountPortalURL resolves to $RESOLVED_ACCOUNT_PORTAL_URL. Builds installed on other Macs will not register installs or sync entitlements unless you override it with MACCLIPPER_ACCOUNT_PORTAL_URL or MACCLIPPER_API_BASE_URL."
  fi

  # Copy Sparkle framework
  log_info "Copying Sparkle framework..."
  SPARKLE_FRAMEWORK="$(find_sparkle_framework "$BUILD_DIR" "$target_arch")"
  /usr/bin/ditto "$SPARKLE_FRAMEWORK" "$app_path/Contents/Frameworks/Sparkle.framework"

  # Make executable
  chmod +x "$app_path/Contents/MacOS/$APP_NAME"

  # Code signing
  SIGNING_IDENTITY="${MACCLIPPER_CODESIGN_IDENTITY:-}"
  if [[ -z "$SIGNING_IDENTITY" ]]; then
    SIGNING_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/Apple Development|Developer ID Application/ { print $2; exit }')"
  fi

  if [[ -n "$SIGNING_IDENTITY" ]]; then
    log_info "Code signing with identity: $SIGNING_IDENTITY"
    codesign --force --deep --sign "$SIGNING_IDENTITY" "$app_path"
    log_success "Built and signed $app_path for $target_arch with $SIGNING_IDENTITY"
  else
    log_info "Code signing with ad-hoc signature"
    codesign --force --deep --sign - --identifier "$BUNDLE_ID" --requirements "=designated => identifier \"$BUNDLE_ID\"" "$app_path"
    log_success "Built and ad-hoc signed $app_path for $target_arch with stable identifier $BUNDLE_ID"
  fi
}

build_dmg_for_app() {
  local app_path="$1"
  local arch="$2"
  local final_dmg="$3"
  local arch_slug
  local temp_dmg
  local staging_dir
  local mount_output
  local device
  local mount_point
  local applescript

  log_info "Building DMG for $arch..."

  arch_slug="$(arch_label "$arch")"
  temp_dmg="$DIST_DIR/$APP_NAME-$arch_slug-temp.dmg"
  staging_dir="$DIST_DIR/dmg-staging-$arch_slug"

  rm -rf "$staging_dir" "$temp_dmg" "$final_dmg"
  mkdir -p "$staging_dir/.background"
  cp -R "$app_path" "$staging_dir/$APP_NAME.app"
  ln -s /Applications "$staging_dir/Applications"
  cp "$ROOT/AppResources/$BACKGROUND_NAME" "$staging_dir/.background/$BACKGROUND_NAME"

  log_info "Creating temporary DMG..."
  hdiutil create -volname "$VOL_NAME" -srcfolder "$staging_dir" -fs HFS+ -format UDRW -ov "$temp_dmg" >/dev/null

  log_info "Mounting DMG for customization..."
  mount_output=$(hdiutil attach -readwrite -noverify -noautoopen "$temp_dmg")
  device=$(echo "$mount_output" | awk '/Apple_HFS/ {print $1}')
  mount_point=$(echo "$mount_output" | sed -n 's#.*\(/Volumes/.*\)#\1#p' | tail -n 1)

  if [[ -z "$device" || -z "$mount_point" ]]; then
    log_error "Failed to mount temporary DMG for $arch"
    exit 1
  fi

  log_info "Customizing DMG appearance..."
  applescript=$(cat <<EOF
 tell application "Finder"
   tell disk "$VOL_NAME"
     open
     set current view of container window to icon view
     set toolbar visible of container window to false
     set statusbar visible of container window to false
     set bounds of container window to {120, 120, 1320, 840}
     set viewOptions to the icon view options of container window
     set arrangement of viewOptions to not arranged
     set icon size of viewOptions to 128
     set text size of viewOptions to 14
     set background picture of viewOptions to file ".background:$BACKGROUND_NAME"
     set position of item "$APP_NAME.app" of container window to {240, 300}
     set position of item "Applications" of container window to {720, 300}
     update without registering applications
     delay 1
     close
     open
     delay 1
   end tell
 end tell
EOF
)

  osascript -e "$applescript" >/dev/null || true
  sync
  sleep 2

  log_info "Converting to compressed DMG..."
  hdiutil detach "$device" >/dev/null
  hdiutil convert "$temp_dmg" -format UDZO -imagekey zlib-level=9 -ov -o "$final_dmg" >/dev/null

  # Cleanup
  rm -f "$temp_dmg"
  rm -rf "$staging_dir"

  log_success "Built $final_dmg"
}

# Main build process
main() {
    log_info "Starting MacClipper distribution build..."
    log_info "Target architectures: ${TARGET_ARCHS[*]}"

    # Change to root directory
    cd "$ROOT"

    # Clean dist directory
    log_info "Cleaning dist directory..."
    rm -rf "$DIST_DIR"
    mkdir -p "$DIST_DIR"

    # Generate DMG background
    log_info "Generating DMG background..."
    swift "$ROOT/scripts/generate_dmg_background.swift"

    # Build for each architecture
    for target_arch in "${TARGET_ARCHS[@]}"; do
        validate_arch "$target_arch"

        app_path="$(app_path_for_arch "$target_arch")"
        final_dmg="$(dmg_path_for_arch "$target_arch")"

        # Build app
        build_app_for_arch "$target_arch" "$app_path"

        # Build DMG
        build_dmg_for_app "$app_path" "$target_arch" "$final_dmg"
    done

    # Create universal copies for native architecture
    native_arch="$(uname -m)"
    if [[ "$native_arch" == "arm64" || "$native_arch" == "x86_64" ]]; then
        native_app_path="$(app_path_for_arch "$native_arch")"
        native_dmg_path="$(dmg_path_for_arch "$native_arch")"

        if [[ -e "$native_app_path" && -e "$native_dmg_path" ]]; then
            log_info "Creating native architecture copies..."
            cp -R "$native_app_path" "$DIST_DIR/$APP_NAME.app"
            cp "$native_dmg_path" "$DIST_DIR/$APP_NAME.dmg"
            log_success "Updated $DIST_DIR/$APP_NAME.app and $DIST_DIR/$APP_NAME.dmg for native arch $native_arch"
        fi
    fi

    log_success "Distribution build complete!"
    log_info "Output files:"
    ls -la "$DIST_DIR"/*.app "$DIST_DIR"/*.dmg 2>/dev/null || true
}

# Run main function
main "$@"