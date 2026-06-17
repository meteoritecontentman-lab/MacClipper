#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export MACCLIPPER_BUILD_TYPE="appstore"
export MACCLIPPER_OUTPUT_DIR="$ROOT/dist/appstore"

"$ROOT/scripts/package_app.sh"
