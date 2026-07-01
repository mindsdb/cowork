#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
APP_PATH="release/mac-universal/MindsHub Cowork.app"
APP_ZIP="release/MindsHub Cowork.app.zip"
DMG_PATH="release/MindsHub Cowork-${VERSION}-universal-custom.dmg"
IDENTITY_NAME="Developer ID Application: MindsDB Inc (498Y665994)"

if [[ -z "${APPLE_ID:-}" || -z "${APPLE_TEAM_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  echo "Error: missing Apple notarization env vars." >&2
  echo "Required: APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD" >&2
  exit 1
fi

# Prevent accidental unsigned mode from parent shell.
unset CSC_IDENTITY_AUTO_DISCOVERY CSC_NAME CSC_KEYCHAIN CSC_LINK CSC_KEY_PASSWORD || true
export npm_config_python="${npm_config_python:-/opt/homebrew/bin/python3.11}"

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "Error: no valid 'Developer ID Application' identity found in keychain." >&2
  exit 1
fi

echo "==> Cleaning previous release artifacts"
rm -rf release/mac-* release/*.blockmap
rm -f release/*.dmg release/*.zip

echo "==> Building signed universal app bundle"
npx electron-builder --mac --universal --dir -c.afterSign=scripts/after-sign-noop.js

echo "==> Verifying app signature"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "==> Creating app zip for notarization"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$APP_ZIP"

echo "==> Notarizing app zip"
APP_NOTARY_OUT="$(xcrun notarytool submit "$APP_ZIP" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait)"
echo "$APP_NOTARY_OUT"

if ! grep -q "status: Accepted" <<<"$APP_NOTARY_OUT"; then
  echo "Error: app zip notarization was not accepted." >&2
  exit 1
fi

echo "==> Stapling and validating app"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "==> Building custom DMG from notarized app"
SKIP_APP_BUILD=1 bash ./scripts/dist-mac-dmg-custom.sh

echo "==> Signing DMG"
codesign --force --timestamp --sign "$IDENTITY_NAME" "$DMG_PATH"

echo "==> Notarizing DMG"
DMG_NOTARY_OUT="$(xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait)"
echo "$DMG_NOTARY_OUT"

if ! grep -q "status: Accepted" <<<"$DMG_NOTARY_OUT"; then
  echo "Error: DMG notarization was not accepted." >&2
  exit 1
fi

echo "==> Stapling and validating DMG"
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"

echo "==> Final artifact hash"
shasum -a 256 "$DMG_PATH"

echo
echo "Release completed:"
echo "  $DMG_PATH"
