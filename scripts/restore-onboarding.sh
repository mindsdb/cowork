#!/usr/bin/env bash
# Restore MindsHub Cowork state after an onboarding reset.
# Reverses what reset-onboarding.sh did.
set -euo pipefail

ANTON_DIR="$HOME/.anton"
COWORK_DIR="$HOME/.cowork"
ELECTRON_DIR="$HOME/Library/Application Support/anton"

echo "=== MindsHub Cowork Onboarding Restore ==="

# Restore ~/.anton/.env
if [ -f "$ANTON_DIR/.env.backup" ]; then
  cp "$ANTON_DIR/.env.backup" "$ANTON_DIR/.env"
  echo "✓ Restored ~/.anton/.env from .env.backup"
else
  echo "⚠ No ~/.anton/.env.backup found — nothing to restore"
fi

# Restore ~/.cowork
if [ -d "$COWORK_DIR.backup" ]; then
  if [ -d "$COWORK_DIR" ]; then
    echo "  Removing current ~/.cowork (created during test)…"
    rm -rf "$COWORK_DIR"
  fi
  mv "$COWORK_DIR.backup" "$COWORK_DIR"
  echo "✓ Restored ~/.cowork from backup"
else
  echo "⚠ No ~/.cowork.backup found — nothing to restore"
fi

# Restore Electron localStorage
if [ -d "$ELECTRON_DIR.backup" ]; then
  rm -rf "$ELECTRON_DIR"
  mv "$ELECTRON_DIR.backup" "$ELECTRON_DIR"
  echo "✓ Restored Electron userData from backup"
else
  echo "⚠ No Electron backup found — nothing to restore"
fi

echo ""
echo "Done. Relaunch MindsHub Cowork to return to your previous state."
