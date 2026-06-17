#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_START="$(date +%s)"

echo "=== MacClipper Build All ==="
echo ""

echo "--- Building Direct Distribution ---"
export MACCLIPPER_BUILD_TYPE="direct"
export MACCLIPPER_OUTPUT_DIR="$ROOT/dist/direct"
"$ROOT/scripts/package_app.sh"
echo ""
echo "Direct build complete: $ROOT/dist/direct/"

echo "--- Building App Store Distribution ---"
export MACCLIPPER_BUILD_TYPE="appstore"
export MACCLIPPER_OUTPUT_DIR="$ROOT/dist/appstore"
"$ROOT/scripts/build_app_store.sh"
echo ""
echo "App Store build complete: $ROOT/dist/appstore/"

BUILD_END="$(date +%s)"
ELAPSED=$((BUILD_END - BUILD_START))
echo "=== All builds completed in ${ELAPSED}s ==="
echo "  Direct:    $ROOT/dist/direct/"
echo "  App Store: $ROOT/dist/appstore/"
