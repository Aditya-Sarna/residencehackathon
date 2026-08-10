#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/desktop"
export PATH="${HOME}/.local/node-v22.15.0-darwin-arm64/bin:${PATH}"
export RESIDENCE_CORE_URL="${RESIDENCE_CORE_URL:-http://127.0.0.1:8700}"

if ! curl -sf "${RESIDENCE_CORE_URL}/health" >/dev/null 2>&1; then
  echo "Warning: Core not reachable at ${RESIDENCE_CORE_URL}"
  echo "Start it: cd core && uvicorn main:app --host 127.0.0.1 --port 8700"
fi

if [[ ! -d node_modules ]]; then
  npm install
fi
exec npm start
