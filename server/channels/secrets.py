"""Required-field helpers for channel adapter credentials.

Channel bridges look up fields from their in-memory ``secrets`` map (loaded
from the DataVault by :mod:`channels.vault_creds`). When a field is missing
or blank, :func:`require_secret` raises :class:`MissingChannelSecret` so the
caller can surface a clear "this credential isn't configured" error instead
of calling a platform API with an empty token.

History
-------
This module used to expose ``load_channel_secrets`` and ``secret_var_name``
helpers that materialised the ``DS_<CHANNEL>_<ACCOUNT>__<FIELD>`` env-var
layout. The dispatch refactor moved credential storage entirely into the
DataVault; the env-var path was deleted along with those helpers.
"""
from __future__ import annotations


class MissingChannelSecret(KeyError):
    """Raised when a required credential field is unset or blank.

    Carries the channel/account/field tuple so the operator can locate the
    right vault entry to fix without reading the surrounding code.
    """

    def __init__(self, channel_type: str, account: str, field: str) -> None:
        self.channel_type = channel_type
        self.account = account
        self.field = field
        super().__init__(
            f"channel credential {field!s} is not configured for "
            f"{channel_type}/{account} — set it via the Configure panel "
            f"in Dispatch (Settings)"
        )


def require_secret(
    secrets: dict[str, str],
    field: str,
    *,
    channel_type: str,
    account: str,
) -> str:
    """Return ``secrets[field]`` stripped, or raise :class:`MissingChannelSecret`.

    Never returns an empty string — an empty / whitespace-only value is
    treated as missing so a half-configured operator setup fails fast
    instead of silently calling a platform API with a blank token.
    """
    raw = secrets.get(field)
    if raw is None:
        raise MissingChannelSecret(channel_type, account, field)
    stripped = raw.strip()
    if not stripped:
        raise MissingChannelSecret(channel_type, account, field)
    return stripped
