#!/usr/bin/env bash
# The legacy package-only installer cannot select a complete release contract.
set -euo pipefail
printf '%s\n' 'This installer is retired. Use the Anton release installer or install-cowork-server.sh.' >&2
exit 1
