#!/usr/bin/env bash
# DEPRECATED: This script installs the legacy anton-agent package.
# For Docker builds, use install-cowork-server.sh instead.
# For local development, use `uv run cowork-server` from the
# cowork-server directory.
#
# Installs anton-agent from PyPI (the mindsdb/anton package, published
# under the name "anton-agent" because "anton" was taken on PyPI).
#
# ANTON_VERSION: package version to install. Defaults to the pinned
#   version below. Override to test a different release.

set -euo pipefail

DEFAULT_VERSION="2.26.5.29.4"
VERSION="${ANTON_VERSION:-$DEFAULT_VERSION}"

echo "→ Installing anton-agent==${VERSION} from PyPI" >&2
pip install --no-cache-dir "anton-agent==${VERSION}"

# Sanity-check: confirm the right anton landed.
python3 -c "import anton.cli, anton.chat" 2>/dev/null \
  || { echo "✗ Installed 'anton-agent' package doesn't look right (missing .cli or .chat)." >&2; \
       exit 1; }
echo "✓ anton-agent installed."
