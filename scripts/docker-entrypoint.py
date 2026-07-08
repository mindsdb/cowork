#!/usr/bin/env python3
"""Container entrypoint — pre-seed provider configuration so the web UI
skips onboarding entirely, then exec the real command (uvicorn).

Pure Python on purpose: the runtime image's allowlist strip (see the
Dockerfile "Final hardening" step) removes coreutils/sed, so shell
utilities like env/grep/sort/mkdir are not available. Python is the
one userland this image guarantees.

Two jobs:

1. Credentials file: if ANTON_ANTHROPIC_API_KEY is not already set and
   COWORK_LLM_CREDS_FILE points at a mounted JSON file, read the API
   key from it. COWORK_LLM_CREDS_FIELD selects the JSON field (default
   "apiKey"). This lets enterprise deployments mount an existing
   credentials file read-only instead of passing the key via env.

2. First-boot settings seed: cowork-server's one-time env->DB
   migration (cowork/migrations.py) reads an .env FILE — NOT the
   process environment — so `docker run -e ANTON_...` alone never
   reaches the settings DB. On first boot, write every ANTON_* env
   var into that file, plus ANTHROPIC_BASE_URL so the flag is visible
   to GET /settings/raw. The migration then seeds the DB and
   GET /settings/configured returns true, which is what makes the SPA
   skip onboarding.

   The file location moved between server releases: <= 0.26.6.x reads
   ~/.anton/.env, >= 0.26.7.x reads ~/.cowork/.env (v2 migration).
   Seed BOTH so the image works across server versions; the anton CLI
   also reads the ~/.anton one.

   An existing file is never touched: after first boot the DB
   (persisted under ~/.cowork) is authoritative and users may have
   changed settings through the UI.

Note ANTHROPIC_BASE_URL must remain a real process env var either way
— the anthropic SDK reads it from os.environ to route API calls to a
custom Anthropic-protocol gateway. Compose/`docker run -e` provides
that; the .env copy is informational.
"""
import json
import os
import sys


def log(msg: str) -> None:
    print(f"entrypoint: {msg}", file=sys.stderr, flush=True)


def load_creds_file_key() -> None:
    if os.environ.get("ANTON_ANTHROPIC_API_KEY"):
        return
    creds_file = os.environ.get("COWORK_LLM_CREDS_FILE")
    if not creds_file or not os.path.isfile(creds_file):
        return
    field = os.environ.get("COWORK_LLM_CREDS_FIELD", "apiKey")
    try:
        with open(creds_file, encoding="utf-8") as f:
            key = json.load(f).get(field) or ""
    except Exception:
        key = ""
    if key:
        os.environ["ANTON_ANTHROPIC_API_KEY"] = key
        log(f"loaded API key from {creds_file} (field {field!r})")
    else:
        log(f"{creds_file} exists but has no usable {field!r} field")


def seed_env_file(env_file: str) -> None:
    env_file = os.path.expanduser(env_file)
    if os.path.exists(env_file):
        return
    lines = [
        f"{key}={value}"
        for key, value in sorted(os.environ.items())
        if key.startswith("ANTON_")
    ]
    if os.environ.get("ANTHROPIC_BASE_URL"):
        lines.append(f"ANTHROPIC_BASE_URL={os.environ['ANTHROPIC_BASE_URL']}")
    if not lines:
        # Nothing to seed (bare `docker run`, onboarding via the UI).
        # Don't create an empty file — that would block seeding on a
        # later restart with env vars added.
        return
    os.makedirs(os.path.dirname(env_file), exist_ok=True)
    fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    log(f"seeded {env_file} from ANTON_* environment")


def main() -> None:
    load_creds_file_key()
    seed_env_file("~/.cowork/.env")  # cowork-server >= 0.26.7.x
    seed_env_file("~/.anton/.env")   # older servers + standalone anton CLI
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
