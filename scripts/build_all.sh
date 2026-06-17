#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_START="$(date +%s)"

echo "=== MacClipper Build ==="
echo ""

export MACCLIPPER_BUILD_TYPE="direct"
export MACCLIPPER_OUTPUT_DIR="$ROOT/dist/direct"
"$ROOT/scripts/package_app.sh"

BUILD_END="$(date +%s)"
ELAPSED=$((BUILD_END - BUILD_START))
echo "=== Build completed in ${ELAPSED}s ==="
echo "  Output: $ROOT/dist/direct/"
