#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MacClipper"
VOL_NAME="MacClipper Installer"
DIST_DIR="$ROOT/dist"
BACKGROUND_NAME="dmg-background.png"
TARGET_ARCHS_STRING="${MACCLIPPER_DMG_ARCHS:-arm64}"
TARGET_ARCHS=(${=TARGET_ARCHS_STRING})
SKIP_PACKAGE_APP="${MACCLIPPER_SKIP_PACKAGE_APP:-0}"
OVERRIDE_APP_PATH="${MACCLIPPER_OUTPUT_APP_PATH:-}"
OVERRIDE_DMG_PATH="${MACCLIPPER_OUTPUT_DMG_PATH:-}"

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
      echo "Unsupported architecture '$1'. Use arm64 or x86_64 in MACCLIPPER_DMG_ARCHS." >&2
      exit 1
      ;;
  esac
}

app_path_for_arch() {
  local arch="$1"
  if [[ -n "$OVERRIDE_APP_PATH" && ${#TARGET_ARCHS[@]} -eq 1 ]]; then
    echo "$OVERRIDE_APP_PATH"
    return
  fi

  if (( ${#TARGET_ARCHS[@]} == 1 )); then
    echo "$DIST_DIR/$APP_NAME.app"
    return
  fi

  echo "$DIST_DIR/$APP_NAME-$(arch_label "$arch").app"
}

dmg_path_for_arch() {
  local arch="$1"
  if [[ -n "$OVERRIDE_DMG_PATH" && ${#TARGET_ARCHS[@]} -eq 1 ]]; then
    echo "$OVERRIDE_DMG_PATH"
    return
  fi

  if (( ${#TARGET_ARCHS[@]} == 1 )); then
    echo "$DIST_DIR/$APP_NAME.dmg"
    return
  fi

  echo "$DIST_DIR/$APP_NAME-$(arch_label "$arch").dmg"
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

  arch_slug="$(arch_label "$arch")"
  temp_dmg="$DIST_DIR/$APP_NAME-$arch_slug-temp.dmg"
  staging_dir="$DIST_DIR/dmg-staging-$arch_slug"

  rm -rf "$staging_dir" "$temp_dmg" "$final_dmg"
  mkdir -p "$staging_dir/.background"
  cp -R "$app_path" "$staging_dir/$APP_NAME.app"
  ln -s /Applications "$staging_dir/Applications"
  cp "$ROOT/AppResources/$BACKGROUND_NAME" "$staging_dir/.background/$BACKGROUND_NAME"

  hdiutil create -volname "$VOL_NAME" -srcfolder "$staging_dir" -fs HFS+ -format UDRW -ov "$temp_dmg" >/dev/null

  mount_output=$(hdiutil attach -readwrite -noverify -noautoopen "$temp_dmg")
  device=$(echo "$mount_output" | awk '/Apple_HFS/ {print $1}')
  mount_point=$(echo "$mount_output" | sed -n 's#.*\(/Volumes/.*\)#\1#p' | tail -n 1)

  if [[ -z "$device" || -z "$mount_point" ]]; then
    echo "Failed to mount temporary DMG for $arch" >&2
    exit 1
  fi

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
     set position of item "$APP_NAME.app" of container window to {256, 307}
     set position of item "Applications" of container window to {856, 307}
     update without registering applications
     delay 1
     close
     open
     delay 1
   end tell
 end tell
EOF
)

  osascript -e "$applescript" || {
    echo "Warning: AppleScript failed for $arch DMG, continuing anyway" >&2
  }
  sync
  sleep 2
  hdiutil detach "$device" >/dev/null
  hdiutil convert "$temp_dmg" -format UDZO -imagekey zlib-level=9 -ov -o "$final_dmg" >/dev/null
  rm -f "$temp_dmg"
  rm -rf "$staging_dir"

  echo "Built $final_dmg"
}

cd "$ROOT"

native_arch="$(uname -m)"
native_app_path=""
native_dmg_path=""

for target_arch in "${TARGET_ARCHS[@]}"; do
  validate_arch "$target_arch"

  # Generate fresh background for each DMG
  swift "$ROOT/scripts/generate_dmg_background.swift"

  app_path="$(app_path_for_arch "$target_arch")"
  final_dmg="$(dmg_path_for_arch "$target_arch")"

  if [[ "$SKIP_PACKAGE_APP" != "1" ]]; then
    MACCLIPPER_BUILD_DMG=0 \
    MACCLIPPER_BUILD_ARCH="$target_arch" \
    MACCLIPPER_OUTPUT_APP_PATH="$app_path" \
      "$ROOT/scripts/package_app.sh"
  elif [[ ! -d "$app_path" ]]; then
    echo "App bundle not found at $app_path" >&2
    exit 1
  fi

  build_dmg_for_app "$app_path" "$target_arch" "$final_dmg"

  if [[ "$target_arch" == "$native_arch" ]]; then
    native_app_path="$app_path"
    native_dmg_path="$final_dmg"
  fi
done

if (( ${#TARGET_ARCHS[@]} > 1 )) && [[ -n "$native_app_path" && -n "$native_dmg_path" ]]; then
  rm -rf "$DIST_DIR/$APP_NAME.app"
  rm -f "$DIST_DIR/$APP_NAME.dmg"
  cp -R "$native_app_path" "$DIST_DIR/$APP_NAME.app"
  cp "$native_dmg_path" "$DIST_DIR/$APP_NAME.dmg"
  echo "Updated $DIST_DIR/$APP_NAME.app and $DIST_DIR/$APP_NAME.dmg for native arch $native_arch"
fi
