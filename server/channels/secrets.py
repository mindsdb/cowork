"""DataVault helpers for channel adapter credentials.

Channel tokens follow the same ``DS_<CHANNEL>_<ACCOUNT>__<FIELD>`` env-var
layout used by the rest of Anton's data vault, so a Slack workspace's bot
token sits at, e.g., ``DS_SLACK_PROD__BOT_TOKEN``.

Adapters call :func:`load_channel_secrets` at setup time to materialize the
field map. The function reads ``os.environ`` after :class:`LocalDataVault`
has injected credentials — so it works regardless of which path put the
values there (Anton CLI, cowork's data-vault wiring, anton_services bundle).
"""
from __future__ import annotations

import os
import re

_SAFE_RE = re.compile(r"[^A-Z0-9]+")


def _slug(value: str) -> str:
    """Uppercase + collapse non-alphanumerics into single underscores."""
    return _SAFE_RE.sub("_", value.upper()).strip("_")


def secret_var_name(channel_type: str, account: str, field: str) -> str:
    """Compose the canonical env var name for a channel credential field.

    >>> secret_var_name("slack", "prod-workspace", "bot_token")
    'DS_SLACK_PROD_WORKSPACE__BOT_TOKEN'
    """
    prefix = f"DS_{_slug(channel_type)}_{_slug(account)}"
    return f"{prefix}__{_slug(field)}"


def load_channel_secrets(channel_type: str, account: str) -> dict[str, str]:
    """Return all ``DS_<CHANNEL>_<ACCOUNT>__*`` env vars as a flat field→value map.

    Field names come back lowercased; values are unmodified. Returns an empty
    dict if no matching vars are set — channels treat that as "credentials
    missing, skip startup" via the registry's None-factory pattern.
    """
    prefix = f"DS_{_slug(channel_type)}_{_slug(account)}__"
    out: dict[str, str] = {}
    for key, value in os.environ.items():
        if key.startswith(prefix) and value:
            field = key[len(prefix):].lower()
            if field:
                out[field] = value
    return out
