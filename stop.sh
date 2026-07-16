#!/usr/bin/env bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.applypilot.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "ApplyPilot is not running."
  exit 0
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "ApplyPilot stopped (PID: $PID)."
else
  echo "The recorded process is no longer running."
fi

rm -f "$PID_FILE"
