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
#   preview → ~/.cowork-preview  (CI per-PR build)
#   stable  → ~/.cowork-stable   (CI staging-branch build)
#   prod    → ~/.cowork          (release build / fallback)
#
# The home holds the DB, .env, state.json, projects, data vault, and (for
# non-prod kinds) the per-channel server logs and uv-installed server binary.
# Terms consent / onboarding flags live in Electron localStorage under the
# channel's OWN userData dir — since the per-channel app-identity split each
# build kind has a separate userData dir (see the ELECTRON_APP_NAME map below),
# so this clears only the localStorage of the kind you pass, not the others.
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

# Electron userData dir = the per-channel app name (app.setName — see
# src/main/channels.ts appName / app-identity.ts). prod is the historical
# 'anton'; non-prod kinds are isolated. Keep in sync with channels.ts appName.
case "$KIND" in
  prod)    ELECTRON_APP_NAME="anton" ;;
  dev)     ELECTRON_APP_NAME="MindsHub Cowork (Dev)" ;;
  preview) ELECTRON_APP_NAME="MindsHub Cowork (Preview)" ;;
  stable)  ELECTRON_APP_NAME="MindsHub Cowork (Staging)" ;;
esac
ELECTRON_DIR="$HOME/Library/Application Support/$ELECTRON_APP_NAME"

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

# Neutralize the legacy ~/.anton migration sources for prod only. On first run
# the prod app copies these files into an empty config home (migrateLegacyHome),
# which would re-seed credentials/provider choice and defeat the reset. Non-prod
# homes deliberately never inherit this prod-era state, so leave it untouched.
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

# Clear this channel's Electron localStorage (terms consent persisted here;
# isolated per build kind via the per-channel userData dir resolved above).
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
