#!/usr/bin/env bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.applypilot.pid"
LOG_FILE="$ROOT_DIR/applypilot.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "ApplyPilot is already running (PID: $(cat "$PID_FILE"))."
  exit 0
fi

cd "$ROOT_DIR/backend"
nohup "$ROOT_DIR/.venv/bin/uvicorn" app:app --host 127.0.0.1 --port 8000 >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

echo "ApplyPilot started: http://127.0.0.1:8000"
echo "Log: $LOG_FILE"
