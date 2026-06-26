#!/usr/bin/env bash
# Install the cowork-server Python package inside a Docker build.
#
# Installs cowork-server from PyPI into /opt/venv.
#
# COWORK_SERVER_VERSION: package version to install. When empty (the
#   default), installs the latest release from PyPI.

set -euo pipefail

VERSION="${COWORK_SERVER_VERSION:-}"

# Create the target venv and install into it.
uv venv /opt/venv
if [ -n "$VERSION" ]; then
    echo "→ Installing cowork-server==${VERSION} from PyPI" >&2
    uv pip install --python /opt/venv/bin/python "cowork-server==${VERSION}"
else
    echo "→ Installing latest cowork-server from PyPI" >&2
    uv pip install --python /opt/venv/bin/python "cowork-server"
fi

# Sanity-check: confirm the cowork server app can be imported.
/opt/venv/bin/python -c "from cowork.server import app; print('✓ cowork-server installed.')"
