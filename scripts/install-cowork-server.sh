#!/usr/bin/env bash
# COWORK_SERVER_REF selects git; otherwise install COWORK_SERVER_VERSION from PyPI, or latest when empty.

set -euo pipefail

VERSION="${COWORK_SERVER_VERSION:-}"
REF="${COWORK_SERVER_REF:-}"

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

/opt/venv/bin/python -c "from cowork.server import app; print('✓ cowork-server installed.')"
