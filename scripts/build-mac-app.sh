#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/desktop"
export PATH="${HOME}/.local/node-v22.15.0-darwin-arm64/bin:${PATH}"

npm install
npm run dist

echo ""
echo "Built:"
ls -la dist/*.zip 2>/dev/null || true
ls -d dist/mac*/Residence.app 2>/dev/null || true
echo ""
echo "Run: open dist/mac-arm64/Residence.app   # or unzip the .zip"
echo "Core must be on :8700"
