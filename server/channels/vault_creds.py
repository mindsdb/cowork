"""DataVault-backed credential helpers for dispatch channel adapters.

The dispatch channels (slack, discord, telegram, whatsapp) keep all of their
credentials on :class:`LocalDataVault`. The Configure-panel PUT endpoints
call :func:`save_credentials` to persist field maps; factories call
:func:`load_credentials` at startup. The vault is the single source of
truth — there is no env-var fallback or filesystem write to ``~/.anton/.env``.

Errors loading or saving (vault module missing, IO failure) are tolerated —
:func:`load_credentials` returns ``{}`` so the factory's None-adapter pattern
keeps working, and :func:`save_credentials` logs the failure but doesn't
raise.
"""
from __future__ import annotations

import logging
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

    A vault error is logged but not raised: the config-PUT endpoint can
    surface the failure as a non-fatal warning, leaving the operator's
    next save attempt to retry.
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
            if secure_keys:
                # Older Anton-core without the secure_keys kwarg can only
                # write plain text. Refuse rather than silently persisting
                # secrets unencrypted; the operator must update anton.
                logger.warning(
                    "vault.save(%s, %s) skipped: installed anton cannot "
                    "encrypt fields %s at rest — update anton to save "
                    "these credentials",
                    channel_type,
                    account,
                    secure_keys,
                )
                return merged
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
