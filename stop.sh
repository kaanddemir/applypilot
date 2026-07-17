#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.applypilot.pid"
UVICORN="$ROOT_DIR/.venv/bin/uvicorn"
PORT="8000"

process_is_applypilot() {
  local pid="$1"
  local command

  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$UVICORN"* && "$command" == *"app:app"* && "$command" == *"--port $PORT"* ]]
}

add_pid() {
  local candidate="$1"
  local existing

  [[ "$candidate" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$candidate" 2>/dev/null || return 0
  process_is_applypilot "$candidate" || return 0

  for existing in "${PIDS[@]:-}"; do
    [ "$existing" = "$candidate" ] && return 0
  done

  PIDS+=("$candidate")
}

PIDS=()

if [ -f "$PID_FILE" ]; then
  add_pid "$(cat "$PID_FILE" 2>/dev/null || true)"
fi

# The PID file may be stale or missing if the terminal/controller stopped first.
# In that case, find only this project's uvicorn process listening on the port.
while IFS= read -r PID; do
  [ -n "$PID" ] && add_pid "$PID"
done < <(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)

if [ "${#PIDS[@]}" -eq 0 ]; then
  rm -f "$PID_FILE"
  echo "ApplyPilot is not running."
  exit 0
fi

for PID in "${PIDS[@]}"; do
  kill -TERM "$PID"
done

for _ in {1..20}; do
  RUNNING=0
  for PID in "${PIDS[@]}"; do
    kill -0 "$PID" 2>/dev/null && RUNNING=1
  done

  [ "$RUNNING" -eq 0 ] && break
  sleep 0.25
done

for PID in "${PIDS[@]}"; do
  if kill -0 "$PID" 2>/dev/null; then
    kill -KILL "$PID"
  fi
done

rm -f "$PID_FILE"
echo "ApplyPilot stopped (PID: ${PIDS[*]})."
