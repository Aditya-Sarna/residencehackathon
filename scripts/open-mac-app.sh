#!/usr/bin/env bash
# Open the packaged Residence Mac app — strips quarantine + ad-hoc signs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/desktop/dist/mac-arm64/Residence.app"
ZIP="$ROOT/desktop/dist/Residence-1.0.0-arm64-mac.zip"
DEST="$HOME/Downloads/Residence.app"

export PATH="${HOME}/.local/node-v22.15.0-darwin-arm64/bin:${PATH}"
# Cursor/CI shells often set this; it makes Electron behave like Node and the app exits instantly.
unset ELECTRON_RUN_AS_NODE

harden() {
  local target="$1"
  # Clear Gatekeeper quarantine so first open isn't blocked
  xattr -cr "$target" 2>/dev/null || true
  xattr -d com.apple.quarantine "$target" 2>/dev/null || true
  # Ad-hoc sign so macOS treats the bundle as a coherent app
  codesign --force --deep --sign - "$target" 2>/dev/null || true
}

if [[ ! -d "$APP" ]]; then
  echo "Building Residence.app…"
  (cd "$ROOT/desktop" && npm install && env -u ELECTRON_RUN_AS_NODE npm run dist)
fi

harden "$APP"

cp -f "$ZIP" "$HOME/Downloads/Residence-1.0.0-arm64-mac.zip" 2>/dev/null || true
rm -rf "$DEST"
cp -R "$APP" "$DEST"
harden "$DEST"

# Ensure stage gate (/ready = Core + DataHub)
if ! curl -sf -m 2 "http://127.0.0.1:8700/ready" >/dev/null 2>&1; then
  echo "Core/DataHub not ready — starting with residence-up.sh…"
  "$ROOT/scripts/residence-up.sh" || true
  for i in $(seq 1 40); do
    curl -sf -m 2 "http://127.0.0.1:8700/ready" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

READY=$(curl -sf -m 2 "http://127.0.0.1:8700/ready" || echo '{}')
if echo "$READY" | grep -q '"ok":true'; then
  echo "Stage ready (Core + DataHub)."
elif echo "$READY" | grep -q '"core":true'; then
  echo "WARN: Core up but DataHub down — captures will queue; demos need GMS."
else
  echo "WARN: Core still offline — Mac app will show offline HUD until uvicorn is up."
fi

# Prefer /Applications so Accessibility grants stick to one stable path.
APPS_DEST="/Applications/Residence.app"
rm -rf "$APPS_DEST"
cp -R "$APP" "$APPS_DEST"
harden "$APPS_DEST"

echo "Opening Residence…"
# Never inherit ELECTRON_RUN_AS_NODE from Cursor/CI — it makes the app exit instantly.
env -u ELECTRON_RUN_AS_NODE open "$APPS_DEST"
echo ""
echo "Installed to $APPS_DEST (also copied to $DEST)."
echo "Look for: menu-bar R · pill UI (Dock optional)."
echo "If capture fails: System Settings → Privacy & Security → Accessibility → Residence ON"
echo "  (if listed but greyed out after an update: toggle OFF then ON)"
echo "If macOS blocks it: System Settings → Privacy & Security → Open Anyway"
echo "Hotkeys: ⌘⇧R capture · ⌘⇧I inbox · ⌘⇧Z undo"
