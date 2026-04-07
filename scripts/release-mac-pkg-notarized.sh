#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
PRODUCT_NAME="$(node -p "require('./package.json').productName || require('./package.json').name")"
ARTIFACT_NAME="$(node -p "(require('./package.json').productName || require('./package.json').name).replace(/\\s+/g, '-')")"
APP_PATH="release/mac-universal/${PRODUCT_NAME}.app"
APP_ZIP="release/${ARTIFACT_NAME}.app.zip"
PKG_PATH="release/${ARTIFACT_NAME}-${VERSION}-universal-signed.pkg"

INSTALLER_IDENTITY="${INSTALLER_IDENTITY:-Developer ID Installer: MindsDB Inc (498Y665994)}"

# CI-friendly fallback names so the script can read values injected from GitHub
# Secrets with either APPLE_* or GH_APPLE_* names.
APPLE_ID_VALUE="${APPLE_ID:-${GH_APPLE_ID:-}}"
APPLE_TEAM_ID_VALUE="${APPLE_TEAM_ID:-${GH_APPLE_TEAM_ID:-}}"
APPLE_APP_SPECIFIC_PASSWORD_VALUE="${APPLE_APP_SPECIFIC_PASSWORD:-${GH_APPLE_APP_SPECIFIC_PASSWORD:-}}"

if [[ -z "${APPLE_ID_VALUE:-}" || -z "${APPLE_TEAM_ID_VALUE:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD_VALUE:-}" ]]; then
  echo "Error: missing Apple notarization env vars." >&2
  echo "Required: APPLE_ID/ GH_APPLE_ID, APPLE_TEAM_ID/ GH_APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD/ GH_APPLE_APP_SPECIFIC_PASSWORD" >&2
  exit 1
fi

# Preserve notarization credentials for manual steps later in this script.
APPLE_API_KEY_VALUE="${APPLE_API_KEY:-}"
APPLE_API_KEY_ID_VALUE="${APPLE_API_KEY_ID:-}"
APPLE_API_KEY_ISSUER_VALUE="${APPLE_API_KEY_ISSUER:-}"

unset CSC_IDENTITY_AUTO_DISCOVERY CSC_NAME CSC_KEYCHAIN CSC_LINK CSC_KEY_PASSWORD || true
export npm_config_python="${npm_config_python:-/opt/homebrew/bin/python3.11}"

# Ensure electron-builder does not trigger scripts/notarize.js during build.
unset APPLE_ID APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_KEY_ISSUER || true

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "Error: no valid 'Developer ID Application' identity found in keychain." >&2
  exit 1
fi

if ! security find-identity -v -p basic | grep -q "Developer ID Installer"; then
  echo "Error: no valid 'Developer ID Installer' identity found in keychain." >&2
  exit 1
fi

echo "==> Cleaning previous mac artifacts"
rm -rf release/mac-* release/*.blockmap
rm -f release/*.dmg release/*.zip release/*.pkg

echo "==> Building latest app code (main + renderer)"
npm run build

echo "==> Building signed universal app bundle"
npx electron-builder --mac --universal --dir -c.afterSign=scripts/after-sign-noop.js

echo "==> Verifying app signature"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "==> Notarizing app zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$APP_ZIP"
APP_NOTARY_OUT="$(xcrun notarytool submit "$APP_ZIP" \
  --apple-id "$APPLE_ID_VALUE" \
  --team-id "$APPLE_TEAM_ID_VALUE" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD_VALUE" \
  --wait)"
echo "$APP_NOTARY_OUT"

if ! grep -q "status: Accepted" <<<"$APP_NOTARY_OUT"; then
  echo "Error: app zip notarization was not accepted." >&2
  exit 1
fi

echo "==> Stapling and validating app"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "==> Building signed installer pkg"
productbuild \
  --component "$APP_PATH" /Applications \
  --sign "$INSTALLER_IDENTITY" \
  "$PKG_PATH"

echo "==> Verifying pkg signature"
pkgutil --check-signature "$PKG_PATH"

echo "==> Notarizing pkg"
PKG_NOTARY_OUT="$(xcrun notarytool submit "$PKG_PATH" \
  --apple-id "$APPLE_ID_VALUE" \
  --team-id "$APPLE_TEAM_ID_VALUE" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD_VALUE" \
  --wait)"
echo "$PKG_NOTARY_OUT"

if ! grep -q "status: Accepted" <<<"$PKG_NOTARY_OUT"; then
  echo "Error: pkg notarization was not accepted." >&2
  exit 1
fi

echo "==> Stapling and validating pkg"
xcrun stapler staple "$PKG_PATH"
xcrun stapler validate "$PKG_PATH"

echo "==> Final artifact hash"
shasum -a 256 "$PKG_PATH"

echo
echo "Release completed:"
echo "  $PKG_PATH"
