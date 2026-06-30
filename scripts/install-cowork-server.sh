#!/usr/bin/env bash
# Install the cowork-server Python package inside a Docker build.
#
# Two install sources, selected at build time:
#   * COWORK_SERVER_REF set (non-empty) → install from the cowork-server git
#     repo at that branch/tag/commit (staging builds).
#   * else                              → install cowork-server from PyPI:
#     a pinned ==VERSION when COWORK_SERVER_VERSION is set, otherwise latest
#     (default; prod / release builds).
#
# COWORK_SERVER_VERSION: PyPI version to install when COWORK_SERVER_REF is empty.
#   When empty (the default), installs the latest release from PyPI.
# COWORK_SERVER_REF: git ref of mindsdb/cowork-server to install instead of PyPI.

set -euo pipefail

VERSION="${COWORK_SERVER_VERSION:-}"
REF="${COWORK_SERVER_REF:-}"

# Create the target venv and install into it.
uv venv /opt/venv
if [ -n "${REF}" ]; then
  echo "→ Installing cowork-server from git ref '${REF}'" >&2
  uv pip install --python /opt/venv/bin/python \
    "cowork-server @ git+https://github.com/mindsdb/cowork-server.git@${REF}"
elif [ -n "${VERSION}" ]; then
  echo "→ Installing cowork-server==${VERSION} from PyPI" >&2
  uv pip install --python /opt/venv/bin/python "cowork-server==${VERSION}"
else
  echo "→ Installing latest cowork-server from PyPI" >&2
  uv pip install --python /opt/venv/bin/python "cowork-server"
fi

# Sanity-check: confirm the cowork server app can be imported.
/opt/venv/bin/python -c "from cowork.server import app; print('✓ cowork-server installed.')"
