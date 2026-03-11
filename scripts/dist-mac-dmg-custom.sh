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

export CSC_IDENTITY_AUTO_DISCOVERY=false
export npm_config_python="${npm_config_python:-/opt/homebrew/bin/python3.11}"

npm run build

# Generate deterministic 1200x800 DMG background from logo.jpg.
swift ./scripts/generate-dmg-background.swift

# Build the macOS app bundle only (no DMG from electron-builder)
npx electron-builder --mac --universal --dir -c.afterSign=scripts/after-sign-noop.js

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: app bundle not found at $APP_PATH" >&2
  exit 1
fi

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
