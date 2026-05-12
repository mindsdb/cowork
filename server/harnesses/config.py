"""Shared harness configuration helpers.

The desktop app stores user-facing configuration in ``~/.anton/.env``.
These helpers are deliberately tiny and dependency-free so both routes and
harness providers can read the selected runtime without importing the settings
router and creating circular imports.
"""

from __future__ import annotations

import os
from pathlib import Path


GLOBAL_ENV_PATH = Path.home() / ".anton" / ".env"
DEFAULT_HERMES_BASE_URL = "http://127.0.0.1:8642"
HARNESS_ENV_KEY = "COWORK_HARNESS_PROVIDER"
HERMES_BASE_URL_ENV_KEY = "COWORK_HERMES_API_BASE_URL"
HERMES_API_KEY_ENV_KEY = "COWORK_HERMES_API_KEY"
HERMES_AUTO_START_ENV_KEY = "COWORK_HERMES_AUTO_START"


def read_dotenv(path: Path = GLOBAL_ENV_PATH) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip().strip('"').strip("'")
    except Exception:
        pass
    return result


def get_env(key: str, default: str = "") -> str:
    val = os.environ.get(key)
    if val:
        return val
    return read_dotenv().get(key, default)


def normalize_harness_id(value: str | None) -> str:
    raw = (value or "anton").strip().lower()
    if raw in {"hermes", "hermes-agent", "hermes_agent"}:
        return "hermes"
    return "anton"


def selected_harness_id() -> str:
    return normalize_harness_id(get_env(HARNESS_ENV_KEY, "anton"))


def hermes_base_url() -> str:
    raw = (
        get_env(HERMES_BASE_URL_ENV_KEY)
        or get_env("HERMES_API_BASE_URL")
        or DEFAULT_HERMES_BASE_URL
    )
    return raw.rstrip("/")


def hermes_api_key() -> str:
    return get_env(HERMES_API_KEY_ENV_KEY) or get_env("API_SERVER_KEY")


def hermes_auto_start() -> bool:
    value = get_env(HERMES_AUTO_START_ENV_KEY, "true").strip().lower()
    return value in {"1", "true", "yes", "on"}
