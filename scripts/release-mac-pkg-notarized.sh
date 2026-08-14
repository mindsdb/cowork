#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PRODUCT_NAME="$(node -e "const fs=require('fs'); const pkg=require('./package.json'); let productName=pkg.productName; try { const builderConfig=fs.readFileSync('./electron-builder.yml', 'utf8'); const match=builderConfig.match(/^\\s*productName:\\s*(.+)\\s*$/m); if (match) productName=match[1].trim().replace(/^['\\\"]|['\\\"]$/g, ''); } catch (error) {} process.stdout.write(productName || pkg.name);")"
# Per-channel bundle identity (empty for prod/dev/unset → electron-builder.yml
# defaults, i.e. prod is unchanged). Mirrors src/main/channels.ts via
# scripts/channel-identity.mjs. When set, PRODUCT_NAME is overridden so APP_PATH
# below points at the actual built .app, and the values are passed to
# electron-builder via -c overrides at the --dir step.
CHANNEL_PRODUCT_NAME="$(node scripts/channel-identity.mjs value productName)"
CHANNEL_APP_ID="$(node scripts/channel-identity.mjs value appId)"
CHANNEL_MAC_ICON="$(node scripts/channel-identity.mjs value macIcon)"
if [[ -n "$CHANNEL_PRODUCT_NAME" ]]; then
  PRODUCT_NAME="$CHANNEL_PRODUCT_NAME"
  echo "==> Channel bundle identity: appId=$CHANNEL_APP_ID productName=$PRODUCT_NAME icon=$CHANNEL_MAC_ICON"
fi

ARTIFACT_NAME="${PRODUCT_NAME// /-}"
APP_PATH="release/mac-universal/${PRODUCT_NAME}.app"
APP_ZIP="release/${ARTIFACT_NAME}.app.zip"

INSTALLER_IDENTITY="${INSTALLER_IDENTITY:-Developer ID Installer: MindsDB Inc (498Y665994)}"
MAC_PKG_UNSIGNED="${MAC_PKG_UNSIGNED:-false}"

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# CI-friendly fallback names so the script can read values injected from GitHub
# Secrets with either APPLE_* or GH_APPLE_* names.
APPLE_ID_VALUE="${APPLE_ID:-${GH_APPLE_ID:-}}"
APPLE_TEAM_ID_VALUE="${APPLE_TEAM_ID:-${GH_APPLE_TEAM_ID:-}}"
APPLE_APP_SPECIFIC_PASSWORD_VALUE="${APPLE_APP_SPECIFIC_PASSWORD:-${GH_APPLE_APP_SPECIFIC_PASSWORD:-}}"

if ! is_truthy "$MAC_PKG_UNSIGNED"; then
  if [[ -z "${APPLE_ID_VALUE:-}" || -z "${APPLE_TEAM_ID_VALUE:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD_VALUE:-}" ]]; then
    echo "Error: missing Apple notarization env vars." >&2
    echo "Required: APPLE_ID/ GH_APPLE_ID, APPLE_TEAM_ID/ GH_APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD/ GH_APPLE_APP_SPECIFIC_PASSWORD" >&2
    exit 1
  fi
fi

# Preserve notarization credentials for manual steps later in this script.
APPLE_API_KEY_VALUE="${APPLE_API_KEY:-}"
APPLE_API_KEY_ID_VALUE="${APPLE_API_KEY_ID:-}"
APPLE_API_KEY_ISSUER_VALUE="${APPLE_API_KEY_ISSUER:-}"

unset CSC_IDENTITY_AUTO_DISCOVERY CSC_NAME CSC_KEYCHAIN CSC_LINK CSC_KEY_PASSWORD || true
if [[ -z "${npm_config_python:-}" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    export npm_config_python="$(command -v python3)"
  else
    export npm_config_python="/opt/homebrew/bin/python3.11"
  fi
fi

# Ensure electron-builder does not trigger scripts/notarize.js during build.
unset APPLE_ID APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_KEY_ISSUER || true

if ! is_truthy "$MAC_PKG_UNSIGNED"; then
  if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    echo "Error: no valid 'Developer ID Application' identity found in keychain." >&2
    exit 1
  fi

  if ! security find-identity -v -p basic | grep -q "Developer ID Installer"; then
    echo "Error: no valid 'Developer ID Installer' identity found in keychain." >&2
    exit 1
  fi
fi

echo "==> Cleaning previous mac artifacts"
rm -rf release/mac-* release/*.blockmap
rm -f release/*.dmg release/*.zip release/*.pkg

echo "==> Building latest app code (main + renderer)"
npm run build
DISPLAY_VERSION="$(tr -d '[:space:]' < src/main/app-version.gen.txt)"
if is_truthy "$MAC_PKG_UNSIGNED"; then
  PKG_PATH="release/${ARTIFACT_NAME}-${DISPLAY_VERSION}-universal-unsigned.pkg"
else
  PKG_PATH="release/${ARTIFACT_NAME}-${DISPLAY_VERSION}-universal-signed.pkg"
fi

if is_truthy "$MAC_PKG_UNSIGNED"; then
  echo "==> Building unsigned universal app bundle"
  export CSC_IDENTITY_AUTO_DISCOVERY=false
else
  echo "==> Building signed universal app bundle"
fi
if [[ -n "$CHANNEL_PRODUCT_NAME" ]]; then
  node scripts/run-electron-builder.mjs --mac --universal --dir \
    -c.afterSign=scripts/after-sign-noop.js \
    -c.appId="$CHANNEL_APP_ID" \
    -c.productName="$CHANNEL_PRODUCT_NAME" \
    -c.mac.icon="$CHANNEL_MAC_ICON"
else
  node scripts/run-electron-builder.mjs --mac --universal --dir -c.afterSign=scripts/after-sign-noop.js
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: app bundle not found at $APP_PATH" >&2
  exit 1
fi

echo "==> Generating component plist (disable relocation)"
COMPONENT_PLIST="release/component.plist"
COMPONENT_PKG="release/component.pkg"
DIST_XML="release/distribution.xml"
pkgbuild --analyze --root "$(dirname "$APP_PATH")" "$COMPONENT_PLIST"
# Disable relocation so macOS always installs to /Applications, even on reinstall.
/usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$COMPONENT_PLIST"

echo "==> Building component pkg (non-relocatable)"
# --scripts (ENG-1241): runs build/pkg-scripts/postinstall as root right
# after the payload lands, to stage the OAuth credentials CI writes to
# build/pkg-scripts/server-credentials.json (see build-macos-pkg.yml) outside
# the signed .app bundle, where the app can later delete it after
# provisioning them into Keychain.
pkgbuild \
  --root "$(dirname "$APP_PATH")" \
  --scripts build/pkg-scripts \
  --install-location /Applications \
  --component-plist "$COMPONENT_PLIST" \
  "$COMPONENT_PKG"

echo "==> Synthesizing distribution"
productbuild --synthesize --package "$COMPONENT_PKG" "$DIST_XML"
# Set the installer title shown in the macOS Installer UI and "move to Trash" dialog.
# The synthesized XML has no <title> element, so insert one after the root tag.
sed -i '' "s|<installer-gui-script[^>]*>|&\n    <title>${PRODUCT_NAME}</title>|" "$DIST_XML"

if is_truthy "$MAC_PKG_UNSIGNED"; then
  echo "==> Building unsigned installer pkg"
  productbuild \
    --distribution "$DIST_XML" \
    --package-path release \
    "$PKG_PATH"
else
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
  rm -f "$APP_ZIP"

  # Package the exact signed/notarized/stapled app as the Squirrel.Mac update
  # payload. Preview remains disabled until it has a durable isolated feed.
  case "${COWORK_BUILD_KIND:-}" in
    prod|stable)
      echo "==> Building shell auto-update zip and latest-mac.yml"
      node scripts/run-electron-builder.mjs \
        --skip-feed-config \
        --prepackaged "$APP_PATH" \
        --mac zip \
        --publish never \
        -c.afterPack=scripts/after-sign-noop.js \
        -c.afterSign=scripts/after-sign-noop.js
      UPDATE_ZIP=$(find release -maxdepth 1 -type f -name 'mindshub-cowork-update-*.zip' -print -quit)
      test -n "$UPDATE_ZIP"
      UPDATER_VERSION=$(tr -d '[:space:]' < src/main/updater-version.gen.txt)
      node scripts/write-update-metadata.mjs \
        --platform mac \
        --artifact "$UPDATE_ZIP" \
        --version "$UPDATER_VERSION" \
        --output release/latest-mac.yml
      ;;
  esac

  echo "==> Building signed installer pkg"
  productbuild \
    --distribution "$DIST_XML" \
    --package-path release \
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
fi

# Clean up intermediate files so `release/*.pkg` glob matches only the final artifact.
rm -f "$COMPONENT_PKG" "$COMPONENT_PLIST" "$DIST_XML"

echo "==> Final artifact hash"
shasum -a 256 "$PKG_PATH"

echo
echo "Release completed:"
echo "  $PKG_PATH"
