#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FIREBASE_PROJECT="${MACCLIPPER_FIREBASE_PROJECT:-macclipper-ce502}"
BACKEND_PORT="${MACCLIPPER_BACKEND_PORT:-4173}"
EMULATOR_UI_PORT="${MACCLIPPER_FIREBASE_UI_PORT:-4000}"
HOSTING_PORT="${MACCLIPPER_HOSTING_PORT:-5005}"
API_URL="http://127.0.0.1:${BACKEND_PORT}"
HOSTING_URL="http://127.0.0.1:${HOSTING_PORT}"
EMULATOR_UI_URL="http://127.0.0.1:${EMULATOR_UI_PORT}"
PROD_SITE_URL="https://${FIREBASE_PROJECT}.web.app"
PROD_API_HEALTH_URL="${PROD_SITE_URL}/api/health"
DEPLOY_STACK=0
OPEN_BROWSER=1

for argument in "$@"; do
  case "$argument" in
    --deploy)
      DEPLOY_STACK=1
      ;;
    --no-open)
      OPEN_BROWSER=0
      ;;
    *)
      echo "Unknown option: $argument" >&2
      echo "Usage: ./initialize.sh [--deploy] [--no-open]" >&2
      exit 1
      ;;
  esac
done

log() {
  printf '[initialize] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

start_background_if_needed() {
  local port="$1"
  local label="$2"
  local command="$3"
  local log_file="$4"

  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    log "$label already running on port $port"
    return
  fi

  log "Starting $label"
  nohup zsh -lc "cd '$ROOT' && $command" >"$log_file" 2>&1 &
}

open_target() {
  local target="$1"

  if [[ "$OPEN_BROWSER" == "1" ]]; then
    open "$target"
  fi
}

require_command swift
require_command npm
require_command firebase
require_command open

cd "$ROOT"

log "Building Firebase functions"
npm --prefix functions run build

log "Building website"
npm --prefix website run build

log "Packaging MacClipper"
./scripts/package_app.sh

if [[ "$DEPLOY_STACK" == "1" ]]; then
  log "Deploying hosting, functions, and firestore to Firebase project $FIREBASE_PROJECT"
  firebase deploy --project "$FIREBASE_PROJECT" --only hosting,functions,firestore
fi

start_background_if_needed "$BACKEND_PORT" "MacClipper bot/API" "npm run web:start" "/tmp/macclipper-backend.log"
start_background_if_needed "$EMULATOR_UI_PORT" "Firebase emulators" "firebase emulators:start --project '$FIREBASE_PROJECT' --only hosting,functions,firestore" "/tmp/macclipper-firebase.log"

BOT_SECRET="$(node backend/server.js --print-bot-secret)"

log "Bot secret: $BOT_SECRET"
log "Opening MacClipper app and local stack"
open_target "$ROOT/dist/MacClipper.app"
open_target "$API_URL/api/bot/health"
open_target "$HOSTING_URL"
open_target "$EMULATOR_UI_URL"

if [[ "$DEPLOY_STACK" == "1" ]]; then
  log "Opening deployed URLs"
  open_target "$PROD_SITE_URL"
  open_target "$PROD_API_HEALTH_URL"
fi

log "Local API: $API_URL"
log "Local website: $HOSTING_URL"
log "Firebase emulator UI: $EMULATOR_UI_URL"
if [[ "$DEPLOY_STACK" == "1" ]]; then
  log "Deployed website: $PROD_SITE_URL"
fi