#!/usr/bin/env bash
set -euo pipefail

export CSC_IDENTITY_AUTO_DISCOVERY=false
export npm_config_python="${npm_config_python:-/opt/homebrew/bin/python3.11}"
npm run build

if [[ "$(uname -m)" == "arm64" ]]; then
  # Finder custom DMG background/layout is unreliable on APFS images.
  # To force HFS+ DMG creation, electron-builder must run under a REAL x64 Node binary.
  X64_NODE=""
  while IFS= read -r candidate; do
    if file "$candidate" 2>/dev/null | grep -q "x86_64"; then
      X64_NODE="$candidate"
      break
    fi
  done < <(printf "%s\n" /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null)

  if [[ -z "$X64_NODE" ]]; then
    echo "ERROR: No x64 Node binary found."
    echo "Install one and retry (needed for HFS+ DMG with visible background)."
    echo "Example:"
    echo "  arch -x86_64 zsh -lc 'source ~/.nvm/nvm.sh && nvm install 20 --arch=x64'"
    exit 1
  fi

  arch -x86_64 "$X64_NODE" ./node_modules/electron-builder/cli.js --mac -c.afterSign=scripts/after-sign-noop.js
else
  npx electron-builder --mac -c.afterSign=scripts/after-sign-noop.js
fi
