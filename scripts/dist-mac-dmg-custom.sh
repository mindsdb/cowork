#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
APP_DIR="release/mac-universal"
APP_NAME="Anton.app"
APP_PATH="$APP_DIR/$APP_NAME"
VOL_NAME="Anton Installer ${VERSION}"
OUT_DMG="release/Anton-${VERSION}-universal-custom.dmg"
SPEC_JSON="release/appdmg.json"

export npm_config_python="${npm_config_python:-/opt/homebrew/bin/python3.11}"
# Ensure we do not accidentally force unsigned mode from a parent shell.
unset CSC_IDENTITY_AUTO_DISCOVERY || true

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "Error: no valid 'Developer ID Application' identity found in keychain." >&2
  echo "Run: security find-identity -v -p codesigning" >&2
  exit 1
fi

npm run build

# Generate deterministic 1200x800 DMG background from logo.jpg.
swift ./scripts/generate-dmg-background.swift

# Build the macOS app bundle only (no DMG from electron-builder), unless caller
# explicitly wants to reuse an existing prebuilt/pre-notarized app bundle.
if [[ "${SKIP_APP_BUILD:-0}" != "1" ]]; then
  npx electron-builder --mac --universal --dir -c.afterSign=scripts/after-sign-noop.js
else
  echo "Skipping app build (SKIP_APP_BUILD=1). Reusing existing $APP_PATH"
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: app bundle not found at $APP_PATH" >&2
  exit 1
fi

echo "Verifying app signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

rm -f "$OUT_DMG"

cat > "$SPEC_JSON" <<EOF
{
  "title": "$VOL_NAME",
  "filesystem": "HFS+",
  "format": "UDZO",
  "icon": "$ROOT_DIR/assets/icon.png",
  "background": "$ROOT_DIR/assets/dmg-background.png",
  "icon-size": 120,
  "window": {
    "size": {
      "width": 1200,
      "height": 800
    }
  },
  "contents": [
    {
      "x": 300,
      "y": 520,
      "type": "file",
      "path": "$ROOT_DIR/$APP_PATH"
    },
    {
      "x": 900,
      "y": 520,
      "type": "link",
      "path": "/Applications"
    }
  ]
}
EOF

npx appdmg "$SPEC_JSON" "$OUT_DMG"

echo "Custom DMG created: $OUT_DMG"
