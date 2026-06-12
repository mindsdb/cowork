#!/usr/bin/env bash
# Reset MindsHub Cowork to a fresh-install state for onboarding testing.
# Backs up existing state so it can be restored with restore-onboarding.sh.
set -euo pipefail

ANTON_DIR="$HOME/.anton"
COWORK_DIR="$HOME/.cowork"
ELECTRON_DIR="$HOME/Library/Application Support/anton"

echo "=== MindsHub Cowork Onboarding Reset ==="

# Back up ~/.anton/.env
if [ -f "$ANTON_DIR/.env" ]; then
  cp "$ANTON_DIR/.env" "$ANTON_DIR/.env.backup"
  echo "# Onboarding reset — original backed up to .env.backup" > "$ANTON_DIR/.env"
  echo "✓ Cleared ~/.anton/.env (backed up to .env.backup)"
else
  echo "– ~/.anton/.env not found, skipping"
fi

# Back up ~/.cowork (DB, projects, data vault, etc.)
if [ -d "$COWORK_DIR" ]; then
  if [ -d "$COWORK_DIR.backup" ]; then
    echo "⚠ ~/.cowork.backup already exists — removing old backup first"
    rm -rf "$COWORK_DIR.backup"
  fi
  mv "$COWORK_DIR" "$COWORK_DIR.backup"
  echo "✓ Moved ~/.cowork → ~/.cowork.backup"
else
  echo "– ~/.cowork not found, skipping"
fi

# Clear Electron localStorage (terms consent persisted here)
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
echo "Done. Relaunch MindsHub Cowork to see the full onboarding flow."
echo "Run restore-onboarding.sh to put everything back."
