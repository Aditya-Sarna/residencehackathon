#!/usr/bin/env bash
# Install a LaunchAgent so Residence Core starts at login (macOS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="ai.residence.core"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PERSIST="$HOME/.residence"
mkdir -p "$PERSIST" "$HOME/Library/LaunchAgents"

# Resolve python/uvicorn
PYTHON="python3"
if [[ -x "$HOME/miniconda3/envs/residence/bin/python" ]]; then
  PYTHON="$HOME/miniconda3/envs/residence/bin/python"
fi
UVICORN="$($PYTHON -c 'import shutil; print(shutil.which("uvicorn") or "")')"
if [[ -z "$UVICORN" ]]; then
  UVICORN="$HOME/miniconda3/envs/residence/bin/uvicorn"
fi

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${UVICORN}</string>
    <string>main:app</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8700</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}/core</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${PERSIST}/launchd-core.log</string>
  <key>StandardErrorPath</key><string>${PERSIST}/launchd-core.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONPATH</key><string>${ROOT}/core</string>
    <key>RESIDENCE_ENV</key><string>production</string>
    <key>RESIDENCE_REQUIRE_AUTH</key><string>0</string>
    <key>RESIDENCE_ALLOW_RESET</key><string>0</string>
    <key>RESIDENCE_RATE_LIMIT_PER_MINUTE</key><string>600</string>
    <key>RESIDENCE_PERSIST_DIR</key><string>${PERSIST}</string>
    <key>DATAHUB_GMS_URL</key><string>http://localhost:8080</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${HOME}/miniconda3/envs/residence/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed LaunchAgent ${LABEL}"
echo "Core will keepAlive on login. Logs: ${PERSIST}/launchd-core.log"
echo "Unload: launchctl unload ~/Library/LaunchAgents/${LABEL}.plist"
