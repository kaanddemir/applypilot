#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.applypilot.pid"
UVICORN="$ROOT_DIR/.venv/bin/uvicorn"
HOST="127.0.0.1"
PORT="8000"

process_is_applypilot() {
  local pid="$1"
  local command

  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$UVICORN"* && "$command" == *"app:app"* && "$command" == *"--port $PORT"* ]]
}

listening_pids() {
  lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"

  if [[ "$PID" =~ ^[0-9]+$ ]] && kill -0 "$PID" 2>/dev/null && process_is_applypilot "$PID"; then
    echo "ApplyPilot is already running (PID: $PID)."
    exit 0
  fi

  rm -f "$PID_FILE"
fi

while IFS= read -r PID; do
  [ -n "$PID" ] || continue

  if process_is_applypilot "$PID"; then
    echo "$PID" >"$PID_FILE"
    echo "ApplyPilot is already running (PID: $PID). PID file restored."
    exit 0
  fi

  echo "Port $PORT is already in use by another process (PID: $PID)." >&2
  exit 1
done < <(listening_pids)

cd "$ROOT_DIR/backend"
nohup "$UVICORN" app:app --host "$HOST" --port "$PORT" >/dev/null 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"

for _ in {1..20}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "ApplyPilot could not be started." >&2
    exit 1
  fi

  if lsof -nP -a -p "$PID" -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ApplyPilot started: http://$HOST:$PORT (PID: $PID)"
    exit 0
  fi

  sleep 0.25
done

kill -TERM "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "ApplyPilot did not start listening on port $PORT." >&2
exit 1
