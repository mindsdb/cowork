#!/usr/bin/env bash
# Back up and reset the selected build's config home and Electron localStorage for onboarding.
# Usage: reset-onboarding.sh [dev|preview|stable|prod] (default dev); restore with the same build kind.
# Keep channels isolated: an older build may not understand another build's DB migrations.
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

# Keep per-channel Electron app names aligned with src/main/channels.ts; prod retains anton.
case "$KIND" in
  prod)    ELECTRON_APP_NAME="anton" ;;
  dev)     ELECTRON_APP_NAME="MindsHub Cowork (Dev)" ;;
  preview) ELECTRON_APP_NAME="MindsHub Cowork (Preview)" ;;
  stable)  ELECTRON_APP_NAME="MindsHub Cowork (Staging)" ;;
esac
ELECTRON_DIR="$HOME/Library/Application Support/$ELECTRON_APP_NAME"

echo "=== MindsHub Cowork Onboarding Reset ($KIND) ==="
echo "Target config home: $COWORK_DIR"

if [ -d "$COWORK_DIR" ]; then
  if [ -d "$COWORK_DIR.backup" ]; then
    echo "⚠ $COWORK_DIR.backup already exists — removing old backup first"
    rm -rf "$COWORK_DIR.backup"
  fi
  mv "$COWORK_DIR" "$COWORK_DIR.backup"
  echo "✓ Moved $COWORK_DIR → $COWORK_DIR.backup"
else
  echo "– $COWORK_DIR not found, skipping"
fi

# Only prod migrates legacy ~/.anton files; move them aside or first launch would repopulate the reset profile.
if [ "$KIND" = "prod" ]; then
  if [ -f "$LEGACY_ANTON_DIR/.env" ]; then
    mv "$LEGACY_ANTON_DIR/.env" "$LEGACY_ANTON_DIR/.env.backup"
    echo "✓ Moved legacy ~/.anton/.env → .env.backup (blocks migration re-seed)"
  else
    echo "– legacy ~/.anton/.env not found, skipping"
  fi
  if [ -f "$LEGACY_ANTON_DIR/cowork/state.json" ]; then
    mv "$LEGACY_ANTON_DIR/cowork/state.json" "$LEGACY_ANTON_DIR/cowork/state.json.backup"
    echo "✓ Moved legacy ~/.anton/cowork/state.json → state.json.backup"
  else
    echo "– legacy ~/.anton/cowork/state.json not found, skipping"
  fi
fi

if [ -d "$ELECTRON_DIR" ]; then
  if [ -d "$ELECTRON_DIR.backup" ]; then
    echo "⚠ Electron backup already exists — removing old backup first"
    rm -rf "$ELECTRON_DIR.backup"
  fi
  cp -a "$ELECTRON_DIR" "$ELECTRON_DIR.backup"
  rm -rf "$ELECTRON_DIR/Local Storage"
  rm -rf "$ELECTRON_DIR/Session Storage"
  echo "✓ Cleared Electron localStorage/sessionStorage (backed up)"
else
  echo "– Electron userData not found, skipping"
fi

echo ""
echo "Done. Relaunch the '$KIND' build to see the full onboarding flow."
echo "Run 'restore-onboarding.sh $KIND' to put everything back."
