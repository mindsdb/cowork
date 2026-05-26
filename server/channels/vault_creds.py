"""DataVault-backed credential helpers for dispatch channel adapters.

The dispatch channels (slack, discord, telegram, whatsapp) historically wrote
their PUT ``/config`` credentials to ``~/.anton/.env`` and resolved them at
runtime via :func:`load_channel_secrets` (the ``DS_<CHANNEL>_<ACCOUNT>__*``
env-var layout). That left credentials in two places:
:class:`LocalDataVault` (written by OAuth callbacks under workspace ids) and
the env file (written by the Configure panel). The split was confusing and
forced operators to know which path stored what.

This module is the single write path. The config endpoints call
:func:`save_credentials` to persist field maps; factories call
:func:`load_credentials` at startup. :func:`migrate_env_to_vault` seeds the
vault from any legacy ``DS_*`` / plain env vars present on first boot then
deletes the migrated keys from both ``~/.anton/.env`` and ``os.environ`` so
the value lives in exactly one place.

Errors loading or saving (vault module missing, IO failure) are tolerated —
:func:`load_credentials` returns ``{}`` so the factory's None-adapter pattern
keeps working, and :func:`save_credentials` logs the failure but doesn't
raise. The config endpoints still report success because the env-var mirror
in :func:`save_credentials` keeps the running bridge usable until restart.
"""
from __future__ import annotations

import logging
import os
from typing import Mapping

logger = logging.getLogger(__name__)


# Sentinel account name for app-level credentials shared across every
# workspace/install (slack client_id, discord public_key, etc.). The double
# underscores make it visually distinct from real account names (team ids,
# guild ids, "default").
APP_ACCOUNT = "__app__"


def _open_vault():
    """Return a LocalDataVault instance, or None if Anton-core is unavailable.

    The vault module ships with Anton-core; older installs may not have it.
    We swallow the import error so a degraded boot still serves the renderer
    — credential reads return empty dicts and the channels stay un-registered.
    """
    try:
        from anton.core.datasources.data_vault import LocalDataVault
        return LocalDataVault()
    except Exception:
        return None


def load_credentials(channel_type: str, account: str) -> dict[str, str]:
    """Return the stored credential field map for one channel account.

    Empty dict on miss or vault failure — channels treat "no creds" as
    "don't register the adapter", same as a brand-new install.
    """
    vault = _open_vault()
    if vault is None:
        return {}
    try:
        stored = vault.load(channel_type, account) or {}
    except Exception:
        logger.debug(
            "vault.load(%s, %s) failed", channel_type, account, exc_info=True
        )
        return {}
    return {k: str(v) for k, v in stored.items() if v}


def save_credentials(
    channel_type: str,
    account: str,
    *,
    writes: Mapping[str, str],
    deletes: tuple[str, ...] = (),
    secure_fields: frozenset[str] = frozenset(),
) -> dict[str, str]:
    """Merge ``writes`` into the stored entry for ``account``; return the result.

    ``deletes`` lists field names to remove from the stored entry. Fields
    named in ``secure_fields`` are flagged for encryption at rest via the
    vault's ``secure_keys`` argument when supported.

    A vault error is logged but not raised: the config-PUT endpoint relies
    on the in-process env-var mirror its caller maintains, so a transient
    save failure doesn't break the running bridge — it just won't survive a
    restart, which the caller can surface in the UI separately.
    """
    vault = _open_vault()
    if vault is None:
        return {}
    try:
        existing = vault.load(channel_type, account) or {}
    except Exception:
        existing = {}
    merged = {k: str(v) for k, v in existing.items() if v}
    for key in deletes:
        merged.pop(key, None)
    for key, value in writes.items():
        merged[key] = value

    secure_keys = sorted(
        f for f in secure_fields if f in merged
    ) or None

    try:
        try:
            vault.save(channel_type, account, merged, secure_keys=secure_keys)
        except TypeError:
            # Older Anton-core without secure_keys kwarg — fall back.
            vault.save(channel_type, account, merged)
    except Exception:
        logger.warning(
            "vault.save(%s, %s) failed; credentials not persisted",
            channel_type,
            account,
            exc_info=True,
        )
        return merged
    return merged


def delete_credentials(channel_type: str, account: str) -> None:
    """Remove one vault entry, swallowing errors.

    Used by the auto-mint paths and the migration helper; the channel-wide
    ``clear_channel_credentials`` deletes every entry for the engine and
    lives in dispatch.py.
    """
    vault = _open_vault()
    if vault is None:
        return
    try:
        vault.delete(channel_type, account)
    except Exception:
        logger.debug(
            "vault.delete(%s, %s) failed", channel_type, account, exc_info=True
        )


def migrate_env_to_vault(
    channel_type: str,
    account: str,
    *,
    env_to_field: Mapping[str, str],
    secure_fields: frozenset[str] = frozenset(),
) -> dict[str, str]:
    """One-shot migration: seed the vault from legacy env vars, then wipe them.

    For each ``env_var → field`` pair, if the env var is set (process env or
    ``~/.anton/.env``) AND the vault entry doesn't already have that field,
    copy the value into the vault entry. After the save succeeds, remove the
    migrated env vars from both ``os.environ`` and ``~/.anton/.env`` so the
    credential lives in exactly one place.

    Idempotent: a second call finds the env vars gone and exits without
    re-touching the vault. Safe to call at module import time.

    Returns the merged field map (or an empty dict if vault was unavailable
    and nothing was migrated).
    """
    # Import locally — settings.py pulls in FastAPI dependencies and we want
    # vault_creds importable from non-route contexts (tests, scripts).
    from routes.settings import _read_dotenv, _write_dotenv, GLOBAL_ENV_PATH

    dotenv = _read_dotenv(GLOBAL_ENV_PATH)

    def _env_get(key: str) -> str:
        # os.environ wins so a session-scoped override (e.g. test fixture)
        # is honoured, matching the precedence the old _*_env_value helpers
        # used.
        raw = os.environ.get(key, "")
        if raw and raw.strip():
            return raw.strip()
        return dotenv.get(key, "").strip()

    candidates: dict[str, tuple[str, str]] = {}
    for env_var, field in env_to_field.items():
        value = _env_get(env_var)
        if value:
            candidates[field] = (env_var, value)

    if not candidates:
        return load_credentials(channel_type, account)

    existing = load_credentials(channel_type, account)
    writes: dict[str, str] = {}
    for field, (_env_var, value) in candidates.items():
        if not existing.get(field):
            writes[field] = value

    merged = existing
    if writes:
        merged = save_credentials(
            channel_type,
            account,
            writes=writes,
            secure_fields=secure_fields,
        )
        if not merged:
            # Save failed — leave env vars in place so the next boot retries.
            logger.warning(
                "could not migrate %s/%s env vars to vault; will retry on next boot",
                channel_type,
                account,
            )
            return existing

    # Vault now has every value we migrated (either freshly written or
    # pre-existing). Remove the legacy env vars so the vault is the only
    # source of truth going forward.
    env_keys_to_wipe = tuple(
        env_var for env_var, _ in candidates.values()
    )
    try:
        _write_dotenv(GLOBAL_ENV_PATH, {}, delete_keys=env_keys_to_wipe)
    except Exception:
        logger.debug(
            "could not strip migrated env vars from %s", GLOBAL_ENV_PATH,
            exc_info=True,
        )
    for env_var in env_keys_to_wipe:
        os.environ.pop(env_var, None)

    return merged
