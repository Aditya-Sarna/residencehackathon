#!/usr/bin/env bash
# Signed + notarized release lane. Local development should use `npm run dist`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/desktop"

: "${CSC_IDENTITY:?Set CSC_IDENTITY to your Developer ID Application certificate}"
: "${APPLE_ID:?Set APPLE_ID for notarization}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD for notarization}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID for notarization}"

export CSC_IDENTITY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
unset ELECTRON_RUN_AS_NODE

cd "$DESKTOP"
npm ci
npx electron-builder --mac dmg zip --publish never

for artifact in dist/*.dmg dist/*.zip; do
  [[ -f "$artifact" ]] || continue
  xcrun notarytool submit "$artifact" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
done

for dmg in dist/*.dmg; do
  [[ -f "$dmg" ]] && xcrun stapler staple "$dmg"
done

echo "Signed, notarized Residence artifacts are in desktop/dist."
