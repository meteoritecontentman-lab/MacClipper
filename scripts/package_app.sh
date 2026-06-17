
#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT/dist"
echo "[TEST] ROOT=$ROOT"
echo "[TEST] DIST_DIR=$DIST_DIR"
mkdir -p "$DIST_DIR"
echo "Hello from package_app.sh test" > "$DIST_DIR/test_output.txt"
echo "[TEST] Wrote test_output.txt to $DIST_DIR"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MacClipper"
UNINSTALLER_EXECUTABLE_NAME="MacClipperUninstaller"
UNINSTALLER_APP_NAME="${MACCLIPPER_UNINSTALLER_APP_NAME:-MacClipper Uninstaller}"
TARGET_ARCH="${MACCLIPPER_BUILD_ARCH:-$(uname -m)}"
DIST_DIR="${MACCLIPPER_OUTPUT_APP_PATH:-$ROOT/dist/$APP_NAME.app}"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ROOT/AppResources/Info.plist")"
UNINSTALLER_BUNDLE_ID="${MACCLIPPER_UNINSTALLER_BUNDLE_ID:-local.macclipper.uninstaller}"
UNINSTALLER_DIST_DIR="${MACCLIPPER_UNINSTALLER_OUTPUT_APP_PATH:-$ROOT/dist/$UNINSTALLER_APP_NAME.app}"
CREATE_DEV_APP="${MACCLIPPER_CREATE_DEV_APP:-1}"
DEV_APP_NAME="${MACCLIPPER_DEV_APP_NAME:-MacClipper Dev}"
DEV_BUNDLE_ID="${MACCLIPPER_DEV_BUNDLE_ID:-local.macclipper.dev}"
DEV_DIST_DIR="${MACCLIPPER_DEV_OUTPUT_APP_PATH:-$ROOT/dist/$DEV_APP_NAME.app}"
BUILD_DMG="${MACCLIPPER_BUILD_DMG:-1}"
DMG_DIST_PATH="${MACCLIPPER_OUTPUT_DMG_PATH:-${DIST_DIR%.app}.dmg}"
DEFAULT_ACCOUNT_PORTAL_URL="$(/usr/libexec/PlistBuddy -c 'Print :MacClipperAccountPortalURL' "$ROOT/AppResources/Info.plist" 2>/dev/null || true)"
DEFAULT_API_BASE_URL="$(/usr/libexec/PlistBuddy -c 'Print :MacClipperAPIBaseURL' "$ROOT/AppResources/Info.plist" 2>/dev/null || true)"
ACCOUNT_PORTAL_URL="${MACCLIPPER_ACCOUNT_PORTAL_URL:-}"
API_BASE_URL="${MACCLIPPER_API_BASE_URL:-}"
NOTARY_PROFILE="${MACCLIPPER_NOTARY_PROFILE:-}"

if [[ -z "$ACCOUNT_PORTAL_URL" && -n "$API_BASE_URL" ]]; then
  ACCOUNT_PORTAL_URL="${API_BASE_URL%/}/buy-4k.html"
fi

case "$TARGET_ARCH" in
  arm64|x86_64)
    ;;
  *)
    echo "Unsupported MACCLIPPER_BUILD_ARCH '$TARGET_ARCH'. Use arm64 or x86_64." >&2
    exit 1
    ;;
esac

find_sparkle_framework() {
  local build_dir="$1"
  local candidates=()

  if [[ -d "$build_dir/Sparkle.framework" ]]; then
    candidates+=("$build_dir/Sparkle.framework")
  fi

  if [[ -d "$ROOT/.build/$TARGET_ARCH-apple-macosx/release/Sparkle.framework" ]]; then
    candidates+=("$ROOT/.build/$TARGET_ARCH-apple-macosx/release/Sparkle.framework")
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
    echo "Unable to locate Sparkle.framework after build." >&2
    return 1
  fi

  printf '%s\n' "${candidates[1]}"
}

codesign_app_bundle() {
  local app_path="$1"
  local bundle_id="$2"

  if [[ -n "$SIGNING_IDENTITY" ]]; then
    codesign --force --deep --sign "$SIGNING_IDENTITY" "$app_path"
  else
    codesign --force --deep --sign - --identifier "$bundle_id" --requirements "=designated => identifier \"$bundle_id\"" "$app_path"
  fi
}

resolve_signing_identity() {
  if [[ -n "${MACCLIPPER_CODESIGN_IDENTITY:-}" ]]; then
    printf '%s\n' "$MACCLIPPER_CODESIGN_IDENTITY"
    return
  fi

  local developer_id
  developer_id="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/Developer ID Application/ { print $2; exit }')"
  if [[ -n "$developer_id" ]]; then
    printf '%s\n' "$developer_id"
    return
  fi

  local apple_development
  apple_development="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/Apple Development/ { print $2; exit }')"
  printf '%s\n' "$apple_development"
}

notarize_and_staple_app() {
  local app_path="$1"

  [[ -n "$NOTARY_PROFILE" ]] || return 0

  if [[ -z "$SIGNING_IDENTITY" || "$SIGNING_IDENTITY" != Developer\ ID\ Application* ]]; then
    echo "Skipping notarization for $app_path because it is not signed with a Developer ID Application certificate." >&2
    return 0
  fi

  echo "Submitting $app_path for notarization with keychain profile $NOTARY_PROFILE"
  xcrun notarytool submit "$app_path" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$app_path"
}

configure_string_key() {
  local plist_path="$1"
  local key_path="$2"
  local value="$3"

  /usr/libexec/PlistBuddy -c "Set $key_path '$value'" "$plist_path" >/dev/null 2>&1 || \
    /usr/libexec/PlistBuddy -c "Add $key_path string '$value'" "$plist_path"
}

configure_bool_key() {
  local plist_path="$1"
  local key_path="$2"
  local value="$3"

  /usr/libexec/PlistBuddy -c "Delete $key_path" "$plist_path" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add $key_path bool $value" "$plist_path"
}

delete_key() {
  local plist_path="$1"
  local key_path="$2"

  /usr/libexec/PlistBuddy -c "Delete $key_path" "$plist_path" >/dev/null 2>&1 || true
}

resolve_codesign_team_identifier() {
  local app_path="$1"
  /usr/bin/codesign -dv --verbose=4 "$app_path" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2; exit}'
}

configure_integrity_policy() {
  local plist_path="$1"
  local enforce_signer="$2"
  local expected_team_id="$3"

  configure_bool_key "$plist_path" ':MacClipperEnforceTrustedSigner' "$enforce_signer"
  if [[ "$enforce_signer" == "true" && -n "$expected_team_id" ]]; then
    configure_string_key "$plist_path" ':MacClipperExpectedTeamIdentifier' "$expected_team_id"
  else
    delete_key "$plist_path" ':MacClipperExpectedTeamIdentifier'
  fi
}

cd "$ROOT"
swift "$ROOT/scripts/generate_dev_icon.swift"
swift "$ROOT/scripts/generate_uninstaller_icon.swift"
BUILD_ARGS=(-c release --arch "$TARGET_ARCH")
BUILD_DIR="$(swift build "${BUILD_ARGS[@]}" --show-bin-path)"
swift build "${BUILD_ARGS[@]}"
EXECUTABLE="$BUILD_DIR/$APP_NAME"
UNINSTALLER_EXECUTABLE="$BUILD_DIR/$UNINSTALLER_EXECUTABLE_NAME"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/Contents/MacOS" "$DIST_DIR/Contents/Resources" "$DIST_DIR/Contents/Frameworks" "$DIST_DIR/Contents/Main-Logs"
cp "$EXECUTABLE" "$DIST_DIR/Contents/MacOS/$APP_NAME"
cp "$ROOT/AppResources/Info.plist" "$DIST_DIR/Contents/Info.plist"
cp "$ROOT/AppResources/AppIcon.icns" "$DIST_DIR/Contents/Resources/AppIcon.icns"
cp "$ROOT/AppResources/Main-Logs-README.txt" "$DIST_DIR/Contents/Main-Logs/README.txt"

if [[ -n "$ACCOUNT_PORTAL_URL" ]]; then
  /usr/libexec/PlistBuddy -c "Set :MacClipperAccountPortalURL $ACCOUNT_PORTAL_URL" "$DIST_DIR/Contents/Info.plist" >/dev/null 2>&1 || \
    /usr/libexec/PlistBuddy -c "Add :MacClipperAccountPortalURL string $ACCOUNT_PORTAL_URL" "$DIST_DIR/Contents/Info.plist"
  echo "Configured MacClipperAccountPortalURL=$ACCOUNT_PORTAL_URL"
fi

if [[ -n "$API_BASE_URL" ]]; then
  /usr/libexec/PlistBuddy -c "Set :MacClipperAPIBaseURL $API_BASE_URL" "$DIST_DIR/Contents/Info.plist" >/dev/null 2>&1 || \
    /usr/libexec/PlistBuddy -c "Add :MacClipperAPIBaseURL string $API_BASE_URL" "$DIST_DIR/Contents/Info.plist"
  echo "Configured MacClipperAPIBaseURL=$API_BASE_URL"
fi

RESOLVED_ACCOUNT_PORTAL_URL="$ACCOUNT_PORTAL_URL"
if [[ -z "$RESOLVED_ACCOUNT_PORTAL_URL" ]]; then
  RESOLVED_ACCOUNT_PORTAL_URL="$DEFAULT_ACCOUNT_PORTAL_URL"
fi

if [[ -z "$API_BASE_URL" ]]; then
  API_BASE_URL="$DEFAULT_API_BASE_URL"
fi

if [[ "$RESOLVED_ACCOUNT_PORTAL_URL" == http://127.0.0.1:* || "$RESOLVED_ACCOUNT_PORTAL_URL" == https://127.0.0.1:* || "$RESOLVED_ACCOUNT_PORTAL_URL" == http://localhost:* || "$RESOLVED_ACCOUNT_PORTAL_URL" == https://localhost:* ]]; then
  echo "Warning: MacClipperAccountPortalURL resolves to $RESOLVED_ACCOUNT_PORTAL_URL. Builds installed on other Macs will not register installs or sync entitlements unless you override it with MACCLIPPER_ACCOUNT_PORTAL_URL or MACCLIPPER_API_BASE_URL." >&2
fi

SPARKLE_FRAMEWORK="$(find_sparkle_framework "$BUILD_DIR")"
/usr/bin/ditto "$SPARKLE_FRAMEWORK" "$DIST_DIR/Contents/Frameworks/Sparkle.framework"

chmod +x "$DIST_DIR/Contents/MacOS/$APP_NAME"
/usr/bin/strip -Sx "$DIST_DIR/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 || true

SIGNING_IDENTITY="$(resolve_signing_identity)"

codesign_app_bundle "$DIST_DIR" "$BUNDLE_ID"
TEAM_IDENTIFIER="$(resolve_codesign_team_identifier "$DIST_DIR")"
if [[ -n "$SIGNING_IDENTITY" && -n "$TEAM_IDENTIFIER" ]]; then
  configure_integrity_policy "$DIST_DIR/Contents/Info.plist" true "$TEAM_IDENTIFIER"
else
  configure_integrity_policy "$DIST_DIR/Contents/Info.plist" false ""
fi
codesign_app_bundle "$DIST_DIR" "$BUNDLE_ID"
notarize_and_staple_app "$DIST_DIR"

if [[ -n "$SIGNING_IDENTITY" ]]; then
  echo "Built and signed $DIST_DIR for $TARGET_ARCH with $SIGNING_IDENTITY"
else
  echo "Built and ad-hoc signed $DIST_DIR for $TARGET_ARCH with stable identifier $BUNDLE_ID"
  echo "Warning: ad-hoc signed builds will look untrusted on other Macs. Use a Developer ID Application certificate plus MACCLIPPER_NOTARY_PROFILE to avoid Gatekeeper verification prompts." >&2
fi

if [[ -n "$SIGNING_IDENTITY" && "$SIGNING_IDENTITY" == Apple\ Development* ]]; then
  echo "Warning: Apple Development signing is fine for your Mac, but external Macs will still treat the app as untrusted. Use a Developer ID Application certificate and notarization for distribution." >&2
elif [[ -n "$SIGNING_IDENTITY" && "$SIGNING_IDENTITY" == Developer\ ID\ Application* && -z "$NOTARY_PROFILE" ]]; then
  echo "Warning: Developer ID signing is present, but this build was not notarized. Set MACCLIPPER_NOTARY_PROFILE to notarize and staple the distributed app." >&2
fi

rm -rf "$UNINSTALLER_DIST_DIR"
mkdir -p "$UNINSTALLER_DIST_DIR/Contents/MacOS" "$UNINSTALLER_DIST_DIR/Contents/Resources"
cp "$UNINSTALLER_EXECUTABLE" "$UNINSTALLER_DIST_DIR/Contents/MacOS/$UNINSTALLER_EXECUTABLE_NAME"
cp "$ROOT/AppResources/Info.plist" "$UNINSTALLER_DIST_DIR/Contents/Info.plist"
cp "$ROOT/AppResources/UninstallerIcon.icns" "$UNINSTALLER_DIST_DIR/Contents/Resources/UninstallerIcon.icns"

configure_string_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':CFBundleDisplayName' "$UNINSTALLER_APP_NAME"
configure_string_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':CFBundleName' "$UNINSTALLER_APP_NAME"
configure_string_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':CFBundleExecutable' "$UNINSTALLER_EXECUTABLE_NAME"
configure_string_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':CFBundleIdentifier' "$UNINSTALLER_BUNDLE_ID"
configure_string_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':CFBundleIconFile' 'UninstallerIcon'
delete_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':CFBundleURLTypes'
configure_bool_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':LSUIElement' false
configure_bool_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':MacClipperEnableUpdater' false
configure_bool_key "$UNINSTALLER_DIST_DIR/Contents/Info.plist" ':SUEnableAutomaticChecks' false

chmod +x "$UNINSTALLER_DIST_DIR/Contents/MacOS/$UNINSTALLER_EXECUTABLE_NAME"
/usr/bin/strip -Sx "$UNINSTALLER_DIST_DIR/Contents/MacOS/$UNINSTALLER_EXECUTABLE_NAME" >/dev/null 2>&1 || true
codesign_app_bundle "$UNINSTALLER_DIST_DIR" "$UNINSTALLER_BUNDLE_ID"
notarize_and_staple_app "$UNINSTALLER_DIST_DIR"

if [[ -n "$SIGNING_IDENTITY" ]]; then
  echo "Built uninstaller app $UNINSTALLER_DIST_DIR for $TARGET_ARCH with $SIGNING_IDENTITY"
else
  echo "Built uninstaller app $UNINSTALLER_DIST_DIR for $TARGET_ARCH with stable identifier $UNINSTALLER_BUNDLE_ID"
fi

if [[ "$CREATE_DEV_APP" != "0" ]]; then
  rm -rf "$DEV_DIST_DIR"
  /usr/bin/ditto "$DIST_DIR" "$DEV_DIST_DIR"
  cp "$ROOT/AppResources/DevAppIcon.icns" "$DEV_DIST_DIR/Contents/Resources/DevAppIcon.icns"

  configure_string_key "$DEV_DIST_DIR/Contents/Info.plist" ':CFBundleDisplayName' "$DEV_APP_NAME"
  configure_string_key "$DEV_DIST_DIR/Contents/Info.plist" ':CFBundleName' "$DEV_APP_NAME"
  configure_string_key "$DEV_DIST_DIR/Contents/Info.plist" ':CFBundleIdentifier' "$DEV_BUNDLE_ID"
  configure_string_key "$DEV_DIST_DIR/Contents/Info.plist" ':CFBundleIconFile' 'DevAppIcon'
  configure_string_key "$DEV_DIST_DIR/Contents/Info.plist" ':CFBundleURLTypes:0:CFBundleURLName' "$DEV_BUNDLE_ID"
  configure_string_key "$DEV_DIST_DIR/Contents/Info.plist" ':CFBundleURLTypes:0:CFBundleURLSchemes:0' 'macclipper-dev'
  configure_bool_key "$DEV_DIST_DIR/Contents/Info.plist" ':MacClipperDeveloperMode' true
  configure_bool_key "$DEV_DIST_DIR/Contents/Info.plist" ':MacClipperEnableUpdater' false
  configure_bool_key "$DEV_DIST_DIR/Contents/Info.plist" ':SUEnableAutomaticChecks' false
  configure_integrity_policy "$DEV_DIST_DIR/Contents/Info.plist" false ""

  codesign_app_bundle "$DEV_DIST_DIR" "$DEV_BUNDLE_ID"
  notarize_and_staple_app "$DEV_DIST_DIR"

  if [[ -n "$SIGNING_IDENTITY" ]]; then
    echo "Built developer app $DEV_DIST_DIR for $TARGET_ARCH with $SIGNING_IDENTITY"
  else
    echo "Built developer app $DEV_DIST_DIR for $TARGET_ARCH with stable identifier $DEV_BUNDLE_ID"
  fi
fi

if [[ "$BUILD_DMG" != "0" ]]; then
  MACCLIPPER_DMG_ARCHS="$TARGET_ARCH" \
  MACCLIPPER_SKIP_PACKAGE_APP=1 \
  MACCLIPPER_OUTPUT_APP_PATH="$DIST_DIR" \
  MACCLIPPER_OUTPUT_DMG_PATH="$DMG_DIST_PATH" \
    "$ROOT/scripts/build_dmg.sh"
fi
