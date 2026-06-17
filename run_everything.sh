#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="/Users/meteorite/MacClipperBot"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ensure_command() {
  if ! command_exists "$1"; then
    echo "Missing required command: $1"
    exit 1
  fi
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

start_process() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"
  shift

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if is_pid_running "$existing_pid"; then
      echo "$name already running (PID $existing_pid)"
      return
    fi
  fi

  echo "Starting $name..."
  nohup "$@" >"$log_file" 2>&1 &
  local new_pid=$!
  echo "$new_pid" >"$pid_file"

  sleep 1
  if ! is_pid_running "$new_pid"; then
    echo "$name failed to start. Check log: $log_file"
    tail -n 20 "$log_file" || true
    exit 1
  fi

  echo "$name started (PID $new_pid)"
}

find_existing_bot_pid() {
  pgrep -f "[Pp]ython(3)? .*bot\.py|${BOT_DIR}/bot.py" | head -n1 || true
}

resolve_bot_token() {
  if [[ -n "${DISCORD_TOKEN:-}" ]]; then
    printf '%s' "$DISCORD_TOKEN"
    return
  fi

  local shared_env="$ROOT_DIR/bot/.env"
  if [[ -f "$shared_env" ]]; then
    local token
    token="$(grep -E '^DISCORD_BOT_TOKEN=' "$shared_env" | head -n1 | cut -d'=' -f2- || true)"
    if [[ -n "$token" ]]; then
      printf '%s' "$token"
      return
    fi
  fi

  printf ''
}

print_status() {
  echo ""
  echo "Local stack status:"
  for service in backend-api firebase-emulators website bot; do
    local pid_file="$PID_DIR/$service.pid"
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if is_pid_running "$pid"; then
        echo "  $service: running (PID $pid)"
      else
        echo "  $service: stopped (stale pid file)"
      fi
    else
      echo "  $service: not started"
    fi
  done

  echo ""
  echo "Logs:"
  echo "  Backend API: $LOG_DIR/backend-api.log"
  echo "  Firebase emulators: $LOG_DIR/firebase-emulators.log"
  echo "  Website: $LOG_DIR/website.log"
  echo "  Bot: $LOG_DIR/bot.log"
  echo ""
  echo "URLs:"
  echo "  Backend API: http://127.0.0.1:4173"
  echo "  Website: http://127.0.0.1:3000"
  echo "  Functions emulator (if started): http://127.0.0.1:5001"
}

ensure_command node
ensure_command npm
ensure_command python3

start_process backend-api node "$ROOT_DIR/backend/server.js"
start_process firebase-emulators bash -lc "cd '$ROOT_DIR/functions' && npm run serve"
start_process website bash -lc "cd '$ROOT_DIR/website' && npm start"

BOT_TOKEN="$(resolve_bot_token)"
if [[ -z "$BOT_TOKEN" ]]; then
  echo "DISCORD_TOKEN is missing. Set DISCORD_TOKEN in your shell or add DISCORD_BOT_TOKEN to $ROOT_DIR/bot/.env"
  exit 1
fi

EXISTING_BOT_PID="$(find_existing_bot_pid)"
if [[ -n "$EXISTING_BOT_PID" ]] && is_pid_running "$EXISTING_BOT_PID"; then
  echo "bot already running (PID $EXISTING_BOT_PID)"
  echo "$EXISTING_BOT_PID" >"$PID_DIR/bot.pid"
else
  start_process bot env DISCORD_TOKEN="$BOT_TOKEN" python3 "$BOT_DIR/bot.py"
fi

print_status
