#!/usr/bin/env bash
# Restore MindsHub Cowork state after an onboarding reset.
# Reverses what reset-onboarding.sh did. Pass the SAME build kind you reset —
# the config-home backup is per-kind (~/.cowork-<kind>.backup).
#
# Usage: ./restore-onboarding.sh [dev|preview|stable|prod]   (default: dev)
set -euo pipefail

KIND="${1:-dev}"
case "$KIND" in
  dev|preview|stable) COWORK_DIR="$HOME/.cowork-$KIND" ;;
  prod)               COWORK_DIR="$HOME/.cowork" ;;
  *)
    echo "✗ Unknown build kind: '$KIND'. Expected one of: dev, preview, stable, prod." >&2
    exit 1
    ;;
esac

LEGACY_ANTON_DIR="$HOME/.anton"

# Electron userData dir = the per-channel app name (app.setName — see
# src/main/channels.ts appName). Keep in sync with channels.ts appName.
case "$KIND" in
  prod)    ELECTRON_APP_NAME="anton" ;;
  dev)     ELECTRON_APP_NAME="MindsHub Cowork (Dev)" ;;
  preview) ELECTRON_APP_NAME="MindsHub Cowork (Preview)" ;;
  stable)  ELECTRON_APP_NAME="MindsHub Cowork (Staging)" ;;
esac
ELECTRON_DIR="$HOME/Library/Application Support/$ELECTRON_APP_NAME"

echo "=== MindsHub Cowork Onboarding Restore ($KIND) ==="
echo "Target config home: $COWORK_DIR"

# Restore the per-build config home.
if [ -d "$COWORK_DIR.backup" ]; then
  if [ -d "$COWORK_DIR" ]; then
    echo "  Removing current $COWORK_DIR (created during test)…"
    rm -rf "$COWORK_DIR"
  fi
  mv "$COWORK_DIR.backup" "$COWORK_DIR"
  echo "✓ Restored $COWORK_DIR from backup"
else
  echo "⚠ No $COWORK_DIR.backup found — nothing to restore"
fi

# Restore the legacy ~/.anton migration sources only for the prod reset that
# moved them aside. Non-prod resets never touch this prod-era state.
if [ "$KIND" = "prod" ]; then
  if [ -f "$LEGACY_ANTON_DIR/.env.backup" ]; then
    mv "$LEGACY_ANTON_DIR/.env.backup" "$LEGACY_ANTON_DIR/.env"
    echo "✓ Restored legacy ~/.anton/.env from backup"
  else
    echo "– No legacy ~/.anton/.env.backup found — skipping"
  fi
  if [ -f "$LEGACY_ANTON_DIR/cowork/state.json.backup" ]; then
    mv "$LEGACY_ANTON_DIR/cowork/state.json.backup" "$LEGACY_ANTON_DIR/cowork/state.json"
    echo "✓ Restored legacy ~/.anton/cowork/state.json from backup"
  else
    echo "– No legacy ~/.anton/cowork/state.json.backup found — skipping"
  fi
fi

# Restore Electron localStorage.
if [ -d "$ELECTRON_DIR.backup" ]; then
  rm -rf "$ELECTRON_DIR"
  mv "$ELECTRON_DIR.backup" "$ELECTRON_DIR"
  echo "✓ Restored Electron userData from backup"
else
  echo "⚠ No Electron backup found — nothing to restore"
fi

echo ""
echo "Done. Relaunch the '$KIND' build to return to your previous state."
