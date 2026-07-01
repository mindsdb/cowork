#!/usr/bin/env bash
# Container entrypoint — pre-seed provider configuration so the web UI
# skips onboarding entirely.
#
# Two jobs, then exec the real command (uvicorn):
#
# 1. LMS credentials file (CVS AIP gateway deployments): if
#    ANTON_ANTHROPIC_API_KEY is not already set, look for a mounted
#    CVS Code credentials file and use its `lmsApiKey` field. Default
#    path: $HOME/.cvscode/.lms-credentials.json — mount the host's
#    ~/.cvscode there read-only. Override the path with
#    COWORK_LMS_CREDS_FILE.
#
# 2. First-boot settings seed: cowork-server's one-time env→DB
#    migration (cowork/migrations.py) reads ~/.anton/.env — NOT the
#    process environment — so `docker run -e ANTON_...` alone never
#    reaches the settings DB. On first boot (no ~/.anton/.env yet)
#    write every ANTON_* env var into that file, plus
#    ANTHROPIC_BASE_URL so the flag is visible to GET /settings/raw.
#    The migration then seeds the DB and GET /settings/configured
#    returns true, which is what makes the SPA skip onboarding.
#
#    An existing ~/.anton/.env is never touched: after first boot the
#    DB (persisted under ~/.cowork) is authoritative and users may
#    have changed settings through the UI.
#
# Note ANTHROPIC_BASE_URL must remain a real process env var either
# way — the anthropic SDK reads it from os.environ to route API calls
# to a custom gateway. Compose/`docker run -e` provides that; the .env
# copy is informational.

set -euo pipefail

if [ -z "${ANTON_ANTHROPIC_API_KEY:-}" ]; then
  creds_file="${COWORK_LMS_CREDS_FILE:-$HOME/.cvscode/.lms-credentials.json}"
  if [ -f "$creds_file" ]; then
    lms_key="$(python -c 'import json,sys; print(json.load(open(sys.argv[1])).get("lmsApiKey") or "")' "$creds_file" 2>/dev/null || true)"
    if [ -n "$lms_key" ]; then
      export ANTON_ANTHROPIC_API_KEY="$lms_key"
      echo "entrypoint: loaded LMS API key from ${creds_file}" >&2
    else
      echo "entrypoint: ${creds_file} exists but has no usable 'lmsApiKey' field" >&2
    fi
  fi
fi

env_file="$HOME/.anton/.env"
if [ ! -f "$env_file" ]; then
  mkdir -p "$HOME/.anton"
  {
    env | LC_ALL=C grep '^ANTON_' | sort || true
    if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
      echo "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}"
    fi
  } > "$env_file"
  chmod 600 "$env_file"
  echo "entrypoint: seeded ${env_file} from ANTON_* environment" >&2
fi

exec "$@"
