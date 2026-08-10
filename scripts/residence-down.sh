#!/usr/bin/env bash
set -euo pipefail
PERSIST="${RESIDENCE_PERSIST_DIR:-$HOME/.residence}"

if [[ -f "$PERSIST/core.pid" ]]; then
  kill "$(cat "$PERSIST/core.pid")" 2>/dev/null || true
  rm -f "$PERSIST/core.pid"
fi
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "vite --host 127.0.0.1 --port 5173" 2>/dev/null || true
echo "Residence stopped."
