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
# COWORK_SERVER_LOCK: directory with requirements.lock and sources.json. When set,
# this complete contract selects both Git projects and replaces version/ref resolution.

set -euo pipefail

VERSION="${COWORK_SERVER_VERSION:-}"
REF="${COWORK_SERVER_REF:-}"

if [ -n "${COWORK_SERVER_LOCK:-}" ]; then
  exec python3 "$(dirname "$0")/install_locked_server.py" install \
    --lock "$COWORK_SERVER_LOCK/requirements.lock" \
    --sources "$COWORK_SERVER_LOCK/sources.json"
fi

if [ -n "${REF}" ]; then
  SOURCE="git+https://github.com/mindsdb/cowork-server.git@${REF}"
elif [ -n "${VERSION}" ]; then
  SOURCE="cowork-server==${VERSION}"
else
  SOURCE="cowork-server"
fi
if [ -n "${ANTON_REF:-}" ]; then
  override_file=$(mktemp)
  trap 'rm -f "$override_file"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  printf 'anton-agent @ git+https://github.com/mindsdb/anton.git@%s\n' "$ANTON_REF" > "$override_file"
  export UV_OVERRIDE="$override_file"
fi
python3 "$(dirname "$0")/install_release_server.py" --venv-python /opt/venv/bin/python -- tool install "$SOURCE"

# Sanity-check: confirm the cowork server app can be imported.
/opt/venv/bin/python -c "from cowork.server import app; print('✓ cowork-server installed.')"
