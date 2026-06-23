#!/usr/bin/env bash
# Install the cowork-server Python package inside a Docker build.
#
# Installs cowork-server from PyPI into /opt/venv.
#
# COWORK_SERVER_VERSION: package version to install. Defaults to the
#   pinned version below. Override to test a different release.

set -euo pipefail

DEFAULT_VERSION="0.1.10"
VERSION="${COWORK_SERVER_VERSION:-$DEFAULT_VERSION}"

echo "→ Installing cowork-server==${VERSION} from PyPI" >&2

# Create the target venv and install into it.
uv venv /opt/venv
uv pip install --python /opt/venv/bin/python "cowork-server==${VERSION}"
mkdir -p "${PLAYWRIGHT_BROWSERS_PATH:-/opt/playwright-browsers}"

# Install Chromium into the shared Playwright browser path when the server
# version includes Playwright. Older server releases do not have this command.
if /opt/venv/bin/python -c "import playwright" >/dev/null 2>&1; then
  /opt/venv/bin/python -m playwright install chromium
fi

# Sanity-check: confirm the cowork server app can be imported.
/opt/venv/bin/python -c "from cowork.server import app; print('✓ cowork-server installed.')"
