"""ChatBridgeBase — common scaffolding for webhook-driven channel adapters.

Subclasses (Slack, WhatsApp, ...) implement the platform-specific bits:
inbound payload parsing, outbound API calls, action-card rendering. The
bridge handles the cross-cutting concerns:

  - Webhook handshake (Slack ``url_verification`` event, WhatsApp ``hub.challenge``).
  - Signature verification dispatch.
  - Outbound text splitting via :func:`split_for_limit`.
  - Configurable retries on transient send failures (left to subclasses;
    the bridge exposes a small helper).

The class is intentionally framework-agnostic: it operates on
``body: bytes``, ``headers: Mapping[str, str]``, ``query: Mapping[str, str]``
so it's testable without FastAPI fixtures and reusable beyond cowork.
"""
from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .text import split_for_limit

logger = logging.getLogger(__name__)


@dataclass
class WebhookHandshake:
    """Result of :meth:`ChatBridgeBase.try_handshake`.

    When ``handled`` is True, the caller (route handler) returns
    ``response_body`` with ``content_type`` immediately and skips the inbound
    parse path. When False, the request is a real event — proceed to verify
    + parse.
    """
    handled: bool
    response_body: str = ""
    content_type: str = "text/plain"
    status_code: int = 200


class ChatBridgeBase(ABC):
    """Common scaffolding every webhook channel inherits.

    Parameters
    ----------
    channel_type
        Short identifier matching :attr:`anton.core.dispatch.adapter.ChannelAdapter.channel_type`.
    account
        Logical account name within this channel (e.g. workspace slug). Used
        for credential lookup so multi-account hosts don't collide.
    secrets
        Pre-resolved field→value map (typically from
        :func:`channels.secrets.load_channel_secrets`).
    max_text_length
        Per-platform character cap for outbound messages. Subclasses set their
        own default; ``send_text`` honors this via :meth:`chunked_send`.
    """

    #: Subclasses override with their platform's hard cap.
    max_text_length: int = 4_000

    def __init__(
        self,
        *,
        channel_type: str,
        account: str,
        secrets: Mapping[str, str],
        max_text_length: int | None = None,
    ) -> None:
        self.channel_type = channel_type
        self.account = account
        self.secrets = dict(secrets)
        if max_text_length is not None:
            self.max_text_length = max_text_length

    # -----------------------------------------------------------------
    # Abstract surface — subclasses implement
    # -----------------------------------------------------------------

    @abstractmethod
    def try_handshake(
        self,
        *,
        method: str,
        body: bytes,
        headers: Mapping[str, str],
        query: Mapping[str, str],
    ) -> WebhookHandshake:
        """Detect and respond to a platform's webhook handshake.

        Slack: POST with JSON ``{"type": "url_verification", "challenge": "..."}``.
        WhatsApp Cloud: GET with ``hub.mode=subscribe&hub.verify_token=...&hub.challenge=...``.
        Subclasses return ``WebhookHandshake(handled=True, ...)`` for those;
        all other inbounds return ``WebhookHandshake(handled=False)``.
        """

    @abstractmethod
    def verify_signature(
        self,
        *,
        body: bytes,
        headers: Mapping[str, str],
    ) -> None:
        """Raise :class:`channels.signatures.SignatureMismatch` on failure."""

    @abstractmethod
    async def parse_inbound(
        self,
        *,
        body: bytes,
        headers: Mapping[str, str],
    ) -> list[Any]:
        """Translate a verified webhook payload into ``InboundEvent`` objects.

        Returns a list because one webhook delivery can carry multiple events
        (Slack batches; WhatsApp may carry multiple ``messages`` per change).
        Returns an empty list for events worth acknowledging but not routing.
        """

    @abstractmethod
    async def send_text(self, *, address: Any, text: str) -> str:
        """Send one chunk of text. Returns the platform-side message id."""

    # -----------------------------------------------------------------
    # Concrete utilities subclasses may override
    # -----------------------------------------------------------------

    async def chunked_send(self, *, address: Any, text: str) -> list[str]:
        """Split ``text`` and send each chunk via :meth:`send_text`.

        Returns the list of platform message ids in order. Short-circuits to
        a single send when the text already fits.
        """
        if not text:
            return []
        chunks = split_for_limit(text, self.max_text_length)
        ids: list[str] = []
        for chunk in chunks:
            mid = await self.send_text(address=address, text=chunk)
            ids.append(mid)
        return ids

    async def set_typing(self, *, address: Any, typing: bool = True) -> None:
        """Optional hook — default no-op; channels with native typing override."""

    async def open_dm(self, user_handle: str) -> Any | None:
        """Optional hook — return a usable address or ``None``.

        Channels where the user handle IS already a usable chat id (WhatsApp
        phone numbers, iMessage addresses) leave the default and callers fall
        through to using the handle directly.
        """
        return None

    # -----------------------------------------------------------------
    # Send-with-retry helper
    # -----------------------------------------------------------------

    async def send_with_retry(
        self,
        coro_factory,
        *,
        attempts: int = 3,
        backoff_s: tuple[float, ...] = (0.5, 2.0, 5.0),
        retry_on: tuple[type[BaseException], ...] = (asyncio.TimeoutError, ConnectionError),
    ):
        """Run ``coro_factory()`` (an async callable) with bounded retries.

        Returns the awaited result on success; re-raises the last exception
        after exhausting ``attempts``. Only retries on the configured error
        types — auth / 4xx errors fail fast.
        """
        last_exc: BaseException | None = None
        for attempt in range(attempts):
            try:
                return await coro_factory()
            except retry_on as exc:
                last_exc = exc
                if attempt + 1 == attempts:
                    break
                delay = backoff_s[min(attempt, len(backoff_s) - 1)]
                logger.warning(
                    "channel send transient failure, retrying",
                    extra={
                        "channel_type": self.channel_type,
                        "account": self.account,
                        "attempt": attempt + 1,
                        "delay_s": delay,
                        "error": repr(exc),
                    },
                )
                await asyncio.sleep(delay)
        assert last_exc is not None  # for type-checkers
        raise last_exc
