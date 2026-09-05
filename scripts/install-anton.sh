#!/usr/bin/env bash
# Deprecated legacy anton-agent installer. Docker builds use install-cowork-server.sh.
# ANTON_VERSION overrides the pinned PyPI version.

set -euo pipefail

DEFAULT_VERSION="2.26.5.29.4"
VERSION="${ANTON_VERSION:-$DEFAULT_VERSION}"

echo "→ Installing anton-agent==${VERSION} from PyPI" >&2
pip install --no-cache-dir "anton-agent==${VERSION}"

python3 -c "import anton.cli, anton.chat" 2>/dev/null \
  || { echo "✗ Installed 'anton-agent' package doesn't look right (missing .cli or .chat)." >&2; \
       exit 1; }
echo "✓ anton-agent installed."
