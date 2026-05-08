#!/usr/bin/env bash
# Install the Anton Python package inside a Docker build.
#
# ANTON_SOURCE controls where to fetch from:
#   local — copy the sibling ./anton/ source tree (build context must be
#           antonworld/, the parent of cowork/, so anton/ is visible).
#           Used by `cowork:dev` images.
#   git   — pull from mindsdb/anton via git+ssh. Requires `--mount=type=ssh`
#           in the Dockerfile RUN that calls this script. Used by prod CI.
#
# ANTON_VERSION (git mode only): branch, tag, or SHA. Defaults to `main`.
#
# Note: PyPI's `anton` package is an unrelated project (Karthik Rangasai's).
# Do NOT `pip install anton` from PyPI — it will install the wrong code.

set -euo pipefail

SOURCE="${ANTON_SOURCE:-git}"

case "$SOURCE" in
  local)
    if [ ! -f /build/anton/pyproject.toml ]; then
      echo "✗ ANTON_SOURCE=local but /build/anton/pyproject.toml not found." >&2
      echo "  Run \`docker build\` from the antonworld/ parent directory so" >&2
      echo "  the anton/ sibling is part of the build context." >&2
      exit 1
    fi
    echo "→ Installing anton from local source at /build/anton" >&2
    pip install --no-cache-dir /build/anton
    ;;
  git)
    REF="${ANTON_VERSION:-main}"
    echo "→ Installing anton from git+ssh://git@github.com/mindsdb/anton.git@${REF}" >&2
    # Ensure SSH host key is trusted at build time. BuildKit's --mount=type=ssh
    # handles auth, but ssh still needs known_hosts.
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
    ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts 2>/dev/null
    pip install --no-cache-dir "git+ssh://git@github.com/mindsdb/anton.git@${REF}"
    ;;
  *)
    echo "✗ Unknown ANTON_SOURCE='${SOURCE}'. Expected 'local' or 'git'." >&2
    exit 1
    ;;
esac

# Sanity-check: confirm the right anton landed (pypi has an unrelated
# package with the same name). mindsdb/anton ships .cli and .chat
# submodules; the unrelated PyPI project doesn't.
python3 -c "import anton.cli, anton.chat" 2>/dev/null \
  || { echo "✗ Installed 'anton' package doesn't look like mindsdb/anton (missing .cli or .chat)." >&2; \
       echo "  Did you accidentally install the unrelated PyPI 'anton' package?" >&2; \
       exit 1; }
echo "✓ anton installed."
