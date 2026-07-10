#!/usr/bin/env bash
# Reset MindsHub Cowork to a fresh-install state for onboarding testing.
# Backs up existing state so it can be restored with restore-onboarding.sh.
#
# Since ENG-324, each build kind keeps its state in a *separate* home so builds
# never share a SQLite DB (an older build reopening a DB a newer build advanced
# fails to start on an unrecognized Alembic migration). Reset the home for the
# build you're actually testing:
#
#   dev     → ~/.cowork-dev      (npm run dev — the default)
#   preview → ~/.cowork-preview  (CI preview build)
#   stable  → ~/.cowork-stable   (CI stable build)
#   prod    → ~/.cowork          (release build / fallback)
#
# The home holds the DB, .env, state.json, projects, and data vault. Terms
# consent lives in Electron localStorage (shared across all build kinds) and is
# cleared regardless of which kind you pass.
#
# Usage: ./reset-onboarding.sh [dev|preview|stable|prod]   (default: dev)
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
ELECTRON_DIR="$HOME/Library/Application Support/anton"

echo "=== MindsHub Cowork Onboarding Reset ($KIND) ==="
echo "Target config home: $COWORK_DIR"

# Back up the per-build config home (DB, .env, state.json, projects, data vault).
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

# Neutralize the legacy ~/.anton migration sources. On first run the app copies
# ~/.anton/.env and ~/.anton/cowork/state.json into the (now-empty) config home
# if they exist (migrateLegacyHome), which would re-seed credentials/provider
# choice and defeat the reset. Move them aside so onboarding starts truly fresh.
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

# Clear Electron localStorage (terms consent persisted here; shared across kinds).
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
