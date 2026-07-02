#!/usr/bin/env python3
"""Container entrypoint — pre-seed provider configuration so the web UI
skips onboarding entirely, then exec the real command (uvicorn).

Pure Python on purpose: the runtime image strips coreutils/sed along
with the libacl/libattr closure (see the Dockerfile "Final hardening"
step), so shell utilities like env/grep/sort/mkdir are not available.
Python is the one userland this image guarantees.

Two jobs:

1. LMS credentials file (CVS AIP gateway deployments): if
   ANTON_ANTHROPIC_API_KEY is not already set, look for a mounted CVS
   Code credentials file and use its `lmsApiKey` field. Default path:
   $HOME/.cvscode/.lms-credentials.json — mount the host's ~/.cvscode
   there read-only. Override the path with COWORK_LMS_CREDS_FILE.

2. First-boot settings seed: cowork-server's one-time env->DB
   migration (cowork/migrations.py) reads ~/.anton/.env — NOT the
   process environment — so `docker run -e ANTON_...` alone never
   reaches the settings DB. On first boot (no ~/.anton/.env yet) write
   every ANTON_* env var into that file, plus ANTHROPIC_BASE_URL so
   the flag is visible to GET /settings/raw. The migration then seeds
   the DB and GET /settings/configured returns true, which is what
   makes the SPA skip onboarding.

   An existing ~/.anton/.env is never touched: after first boot the
   DB (persisted under ~/.cowork) is authoritative and users may have
   changed settings through the UI.

Note ANTHROPIC_BASE_URL must remain a real process env var either way
— the anthropic SDK reads it from os.environ to route API calls to a
custom gateway. Compose/`docker run -e` provides that; the .env copy
is informational.
"""
import json
import os
import sys


def log(msg: str) -> None:
    print(f"entrypoint: {msg}", file=sys.stderr, flush=True)


def load_lms_key() -> None:
    if os.environ.get("ANTON_ANTHROPIC_API_KEY"):
        return
    creds_file = os.environ.get("COWORK_LMS_CREDS_FILE") or os.path.expanduser(
        "~/.cvscode/.lms-credentials.json"
    )
    if not os.path.isfile(creds_file):
        return
    try:
        with open(creds_file, encoding="utf-8") as f:
            key = json.load(f).get("lmsApiKey") or ""
    except Exception:
        key = ""
    if key:
        os.environ["ANTON_ANTHROPIC_API_KEY"] = key
        log(f"loaded LMS API key from {creds_file}")
    else:
        log(f"{creds_file} exists but has no usable 'lmsApiKey' field")


def seed_env_file() -> None:
    env_file = os.path.expanduser("~/.anton/.env")
    if os.path.exists(env_file):
        return
    os.makedirs(os.path.dirname(env_file), exist_ok=True)
    lines = [
        f"{key}={value}"
        for key, value in sorted(os.environ.items())
        if key.startswith("ANTON_")
    ]
    if os.environ.get("ANTHROPIC_BASE_URL"):
        lines.append(f"ANTHROPIC_BASE_URL={os.environ['ANTHROPIC_BASE_URL']}")
    fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    log(f"seeded {env_file} from ANTON_* environment")


def main() -> None:
    load_lms_key()
    seed_env_file()
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
