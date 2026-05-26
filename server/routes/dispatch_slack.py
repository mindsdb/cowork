"""Slack channel adapter + HTTP routes (OAuth install + Events API webhook).

Components:
    SlackBridge       — concrete :class:`ChatBridgeBase` that also satisfies
                        :class:`anton.core.dispatch.adapter.ChannelAdapter`,
                        so the dispatch registry can hand it to the router.
    OAuth start/cb    — install URL + token-exchange callback; bot tokens
                        land in the DataVault under the workspace's team_id.
    POST /events      — Events API webhook. Handles ``url_verification`` and
                        ``event_callback`` envelopes, dispatches inbound
                        messages to the dispatch router via the bridge.

Credentials:
    All Slack credentials live in the DataVault. App-level fields
    (client_id, client_secret, signing_secret, app_token) sit on a single
    ``slack/__app__`` entry written by the Configure panel; workspace-level
    fields (bot_token) sit on per-team rows written by the OAuth callback.
"""
from __future__ import annotations

import asyncio
import html as html_lib
import httpx
import json
import logging
import os
import secrets as secrets_mod
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

# anton.core.dispatch ships only on the dispatch-enabled branch of anton.
# When the installed anton lacks it, define module-level state as stubs so
# main.py can still mount the prefix; the adapter just never registers.
# `from __future__ import annotations` (line 18) stringifies all type hints
# below, so missing names don't break class definition — only construction.
try:
    from anton.core.dispatch.adapter import (
        ChannelAdapter,
        ChannelSetup,
        InboundEvent,
        InboundMessage,
        OutboundMessage,
        PlatformAddress,
    )
    from anton.core.dispatch.registry import register_channel_adapter
    _DISPATCH_AVAILABLE = True
except ImportError:
    _DISPATCH_AVAILABLE = False

from channels import (
    ChatBridgeBase,
    SignatureMismatch,
    WebhookHandshake,
    verify_slack,
)
from channels.vault_creds import APP_ACCOUNT, load_credentials, save_credentials
from .cowork_state import load_state, update_state
from .dispatch import clear_channel_credentials, register_credential_clearer

logger = logging.getLogger(__name__)
router = APIRouter()

SLACK_API_BASE = "https://slack.com/api"
SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"
SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access"
SLACK_OAUTH_SCOPES = (
    "app_mentions:read",
    "chat:write",
    "im:history",
    "im:read",
    "im:write",
    "channels:history",
    "channels:read",
    "groups:history",
    "groups:read",
    "users:read",
)
SLACK_OAUTH_STATE_KEY = "slack_oauth"


# ---------------------------------------------------------------------------
# SlackBridge
# ---------------------------------------------------------------------------


class SlackBridge(ChatBridgeBase):
    """Slack adapter built on :class:`ChatBridgeBase`.

    Implements both the bridge abstracts (``try_handshake``,
    ``verify_signature``, ``parse_inbound``, ``send_text``) and the
    :class:`anton.core.dispatch.adapter.ChannelAdapter` Protocol
    (``setup``, ``shutdown``, ``deliver``, ``show_action_card``) so the
    dispatch registry can hand it to the router.
    """

    max_text_length = 3500   # Slack's recommended readability ceiling
    supports_threads = True

    def __init__(self, account: str, channel_secrets: dict[str, str]) -> None:
        super().__init__(
            channel_type="slack",
            account=account,
            secrets=channel_secrets,
        )
        self._setup: ChannelSetup | None = None
        # Socket Mode connection — populated when an app_token is configured.
        # Falls back to webhook ingress when None.
        self._socket_task: Any = None
        self._socket_client: Any = None

    # -----------------------------------------------------------------
    # ChannelAdapter Protocol
    # -----------------------------------------------------------------

    async def setup(self, setup: ChannelSetup) -> None:
        self._setup = setup
        app_token = (self.secrets.get("app_token") or "").strip()
        if app_token:
            self._socket_task = asyncio.create_task(
                self._run_socket_mode(app_token),
                name=f"slack-socket-{self.account}",
            )
            logger.info(
                "SlackBridge ready for account=%s (Socket Mode enabled)",
                self.account,
            )
        else:
            logger.info(
                "SlackBridge ready for account=%s (webhook mode — set SLACK_APP_TOKEN to use Socket Mode)",
                self.account,
            )

    async def shutdown(self) -> None:
        if self._socket_client is not None:
            try:
                await self._socket_client.disconnect()
            except Exception:
                logger.debug("Socket Mode disconnect failed", exc_info=True)
            self._socket_client = None
        if self._socket_task is not None and not self._socket_task.done():
            self._socket_task.cancel()
            try:
                await self._socket_task
            except (asyncio.CancelledError, Exception):
                pass
        self._socket_task = None
        self._setup = None
        await self.drain_inbound_tasks()

    async def deliver(self, message: OutboundMessage) -> None:
        await self.chunked_send(address=message.address, text=message.text)

    async def show_action_card(
        self,
        address: PlatformAddress,
        card: Any,
    ) -> None:
        """Render an action card. v1 falls back to a plain-text prompt; a
        Block Kit version with real buttons is a follow-on."""
        bullets = "\n".join(f"  • {o.label}" for o in getattr(card, "options", []))
        text = f"*{card.title}*\n{card.question}\n{bullets}".strip()
        await self.chunked_send(address=address, text=text)

    # -----------------------------------------------------------------
    # Webhook plumbing — the FastAPI route delegates to these
    # -----------------------------------------------------------------

    def dispatch_webhook_events(self, events: list[InboundEvent]) -> None:
        """Forward parsed events to the router in the background.

        Returns immediately so the webhook route can ACK Slack within its
        ~3 s Events API budget — a slow ACK makes Slack retry the delivery,
        which would run (and reply from) the agent twice. Routing happens
        via :meth:`ChatBridgeBase.schedule_inbound`.
        """
        if self._setup is None:
            logger.warning("SlackBridge received events before setup completed")
            return
        self.schedule_inbound(events, self._setup.on_inbound)

    # -----------------------------------------------------------------
    # ChatBridgeBase abstracts
    # -----------------------------------------------------------------

    def try_handshake(
        self,
        *,
        method: str,
        body: bytes,
        headers,
        query,
    ) -> WebhookHandshake:
        # Slack: POST with JSON body {"type": "url_verification", "challenge": "..."}
        if method != "POST" or not body:
            return WebhookHandshake(handled=False)
        try:
            data = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return WebhookHandshake(handled=False)
        if isinstance(data, dict) and data.get("type") == "url_verification":
            return WebhookHandshake(
                handled=True,
                response_body=str(data.get("challenge", "")),
                content_type="text/plain",
            )
        return WebhookHandshake(handled=False)

    def verify_signature(self, *, body: bytes, headers) -> None:
        signing_secret = self.secrets.get("signing_secret") or ""
        timestamp = headers.get("x-slack-request-timestamp", "")
        signature = headers.get("x-slack-signature", "")
        verify_slack(
            body,
            signing_secret=signing_secret,
            timestamp=timestamp,
            signature=signature,
        )

    def _normalize_event(self, event: dict) -> InboundEvent | None:
        """Translate one Slack event dict into an :class:`InboundEvent`.

        Returns None for events we should skip (bot echoes, edits/deletes,
        non-chat event types). Shared by :meth:`parse_inbound` (webhook
        path) and the Socket Mode listener so both ingress paths produce
        identical InboundEvent shapes.
        """
        kind = event.get("type")
        if kind not in ("message", "app_mention"):
            return None
        if event.get("bot_id") or event.get("subtype") in (
            "bot_message",
            "message_changed",
            "message_deleted",
        ):
            return None

        text = event.get("text", "") or ""
        channel = event.get("channel", "") or ""
        thread_ts = event.get("thread_ts")
        ts = event.get("ts", "") or ""
        user = event.get("user", "") or None

        try:
            timestamp = (
                datetime.fromtimestamp(float(ts), timezone.utc)
                if ts
                else datetime.now(timezone.utc)
            )
        except (TypeError, ValueError):
            timestamp = datetime.now(timezone.utc)

        is_group = not channel.startswith("D")

        return InboundEvent(
            address=PlatformAddress(
                channel_type="slack",
                platform_id=channel,
                thread_id=thread_ts,
            ),
            message=InboundMessage(
                id=ts,
                content=text,
                timestamp=timestamp,
                kind="chat",
                sender_id=user,
                is_mention=kind == "app_mention",
                is_group=is_group,
            ),
        )

    async def parse_inbound(
        self,
        *,
        body: bytes,
        headers,
    ) -> list[InboundEvent]:
        try:
            data = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return []
        if not isinstance(data, dict) or data.get("type") != "event_callback":
            return []
        inbound = self._normalize_event(data.get("event") or {})
        return [inbound] if inbound else []

    # -----------------------------------------------------------------
    # Socket Mode — alternative ingress path that doesn't need webhooks
    # -----------------------------------------------------------------

    async def _run_socket_mode(self, app_token: str) -> None:
        """Open and serve a Slack Socket Mode connection.

        Slack pushes events down a WebSocket we initiate, so we don't need
        a publicly reachable webhook URL. The listener feeds the same
        ``setup.on_inbound`` callback the webhook route uses, so the
        downstream router/orchestrator code is unchanged.

        Reconnects automatically — slack-sdk's SocketModeClient handles
        the disconnect/reconnect dance internally.
        """
        try:
            from slack_sdk.socket_mode.aiohttp import SocketModeClient
            from slack_sdk.socket_mode.request import SocketModeRequest
            from slack_sdk.socket_mode.response import SocketModeResponse
            from slack_sdk.web.async_client import AsyncWebClient
        except ImportError:
            logger.error(
                "slack-sdk not installed; Socket Mode unavailable. "
                "Add `slack-sdk` to requirements.txt."
            )
            return

        bot_token = self.secrets.get("bot_token") or ""
        if not bot_token:
            logger.warning(
                "Socket Mode requested but bot_token missing — skipping listener",
            )
            return

        self._socket_client = SocketModeClient(
            app_token=app_token,
            web_client=AsyncWebClient(token=bot_token),
        )

        async def _listener(client: "SocketModeClient", req: "SocketModeRequest"):
            # Surface every inbound envelope at INFO so we can see traffic
            # without bumping slack_sdk's DEBUG (which is very noisy).
            logger.info(
                "Socket Mode received: type=%s envelope=%s",
                req.type,
                req.envelope_id,
            )

            # Always ack first — Slack expects an acknowledgement within 3s.
            try:
                await client.send_socket_mode_response(
                    SocketModeResponse(envelope_id=req.envelope_id),
                )
            except Exception:
                logger.debug("Socket Mode ack failed", exc_info=True)

            if req.type != "events_api":
                logger.info("Socket Mode skipped non-events_api: %s", req.type)
                return
            payload = req.payload or {}
            event = payload.get("event") or {}
            event_type = event.get("type") or "<no type>"
            logger.info(
                "Socket Mode events_api event: type=%s channel=%s user=%s",
                event_type,
                event.get("channel"),
                event.get("user"),
            )
            inbound = self._normalize_event(event)
            if inbound is None:
                logger.info(
                    "Socket Mode event skipped by _normalize_event (kind=%s subtype=%s bot_id=%s)",
                    event_type,
                    event.get("subtype"),
                    event.get("bot_id"),
                )
                return
            if self._setup is None:
                logger.warning("Socket Mode received event but ChannelSetup is None")
                return
            if self.is_duplicate_inbound(inbound.message.id):
                logger.info(
                    "Socket Mode dropping duplicate event %s", inbound.message.id
                )
                return
            try:
                await self._setup.on_inbound(inbound)
                logger.info(
                    "Socket Mode dispatched to router: %s",
                    inbound.message.id,
                )
            except Exception:
                logger.exception(
                    "router.on_inbound raised for slack socket-mode event %s",
                    inbound.message.id,
                )

        self._socket_client.socket_mode_request_listeners.append(_listener)

        try:
            await self._socket_client.connect()
            # Block forever — connection lifetime is tied to the asyncio
            # task, which gets cancelled in shutdown().
            await asyncio.Future()
        except asyncio.CancelledError:
            try:
                await self._socket_client.disconnect()
            except Exception:
                pass
            raise
        except Exception:
            logger.exception("Socket Mode connection error for account=%s", self.account)

    async def send_text(self, *, address: PlatformAddress, text: str) -> str:
        """Post a single chunk via Slack's ``chat.postMessage``.

        Maps Slack's "ok: false, error: ratelimited / internal_error" 200
        responses to :class:`ConnectionError` so the bridge's send-with-retry
        wrapper kicks in. Other non-OK errors (channel_not_found,
        invalid_auth, ...) raise :class:`RuntimeError` and fail fast.
        """
        bot_token = self.require_secret("bot_token")
        payload: dict[str, Any] = {
            "channel": address.platform_id,
            "text": text,
        }
        if address.thread_id:
            payload["thread_ts"] = address.thread_id

        result = await self._call_web_api("chat.postMessage", payload, bot_token=bot_token)
        if not result.get("ok"):
            err = result.get("error", "")
            if err in ("ratelimited", "internal_error", "service_unavailable"):
                raise ConnectionError(f"slack transient error: {err}")
            raise RuntimeError(f"slack chat.postMessage failed: {err}")
        return str(result.get("ts", ""))

    # -----------------------------------------------------------------
    # Internal: thin Slack Web API client
    # -----------------------------------------------------------------

    @staticmethod
    async def _call_web_api(method: str, payload: dict[str, Any], *, bot_token: str) -> dict[str, Any]:
        """Await one Slack Web API call; returns the parsed JSON body.

        Awaited directly via httpx (not a blocking urlopen in a worker
        thread) so the call is cancellable — a send in flight at shutdown
        no longer pins the process. Network-transport failures and
        unparseable 429/5xx responses are raised as :class:`ConnectionError`
        so the bridge's ``send_with_retry`` wrapper kicks in. Slack also
        encodes transient errors as a 200 ``{"ok": false, ...}`` body —
        :meth:`send_text` maps those.
        """
        from channels.bridge import RETRYABLE_HTTP_STATUS

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{SLACK_API_BASE}/{method}",
                    json=payload,
                    headers={"Authorization": f"Bearer {bot_token}"},
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ConnectionError(f"slack {method} transport error: {exc!r}") from exc
        try:
            return resp.json()
        except ValueError as exc:
            if resp.status_code in RETRYABLE_HTTP_STATUS:
                raise ConnectionError(
                    f"slack {method} HTTP {resp.status_code} (no JSON body)"
                ) from exc
            raise RuntimeError(
                f"slack {method} HTTP {resp.status_code}: {resp.text[:200]}"
            ) from exc


# ---------------------------------------------------------------------------
# Adapter registration — runs on import so the registry sees Slack as a
# registered channel even before OAuth is finished.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Vault credential layout
# ---------------------------------------------------------------------------

# Slack credentials split across two vault rows:
#   slack/<team_id>   — workspace-scoped: bot_token (from OAuth callback),
#                        plus a copy of signing_secret stamped at install time.
#   slack/__app__     — app-level: client_id, client_secret, signing_secret,
#                        app_token (Socket Mode). One per install.
# The factory loads the workspace row, then layers app-level values on top
# so a fresh OAuth install picks up app_token / signing_secret without the
# operator re-entering them per workspace.
_SLACK_APP_FIELDS = ("client_id", "client_secret", "signing_secret", "app_token")
_SLACK_APP_SECURE = frozenset({"client_secret", "signing_secret", "app_token"})
_SLACK_WORKSPACE_SECURE = frozenset({"bot_token", "signing_secret"})


def _slack_app_creds() -> dict[str, str]:
    """Return the app-level credential map (client_id, signing_secret, etc.)."""
    return load_credentials("slack", APP_ACCOUNT)


async def _slack_adapter_factory() -> ChannelAdapter | None:
    """Build a SlackBridge from the first usable Slack workspace.

    Resolution order:
      1. ``ANTON_SLACK_ACCOUNT`` env var pin — explicit account name.
      2. Any ``slack-*`` entry in the local DataVault other than ``__app__``
         (the OAuth callback saves under the workspace's team_id, e.g.
         ``slack-T0B0DG30BKL``).

    App-level credentials (signing_secret, app_token) live on the
    ``slack/__app__`` vault entry and are layered onto each workspace's
    field map so Socket Mode and webhook signature verification keep
    working without per-workspace duplication.
    """
    try:
        from anton.core.datasources.data_vault import LocalDataVault
        vault = LocalDataVault()
        workspace_conns = [
            c["name"]
            for c in vault.list_connections()
            if c.get("engine") == "slack" and c.get("name") != APP_ACCOUNT
        ]
    except Exception:
        workspace_conns = []

    app_creds = _slack_app_creds()
    app_token = (app_creds.get("app_token") or "").strip()
    signing_secret = (app_creds.get("signing_secret") or "").strip()

    explicit = os.environ.get("ANTON_SLACK_ACCOUNT", "").strip()
    if explicit:
        candidates = [explicit]
    elif workspace_conns:
        candidates = workspace_conns
    else:
        candidates = ["default"]

    for name in candidates:
        fields = load_credentials("slack", name)
        if app_token:
            fields["app_token"] = app_token
        if signing_secret and not fields.get("signing_secret"):
            fields["signing_secret"] = signing_secret
        if fields.get("bot_token") and fields.get("signing_secret"):
            logger.info(
                "SlackBridge factory selected account=%s (socket=%s)",
                name, bool(app_token),
            )
            return SlackBridge(account=name, channel_secrets=fields)
    return None


if _DISPATCH_AVAILABLE:
    register_channel_adapter("slack", _slack_adapter_factory)
else:
    logger.warning(
        "anton.core.dispatch not available; Slack adapter not registered. "
        "Install anton from a dispatch-enabled build to enable Slack dispatch."
    )


# ---------------------------------------------------------------------------
# Config panel — read/write Slack OAuth env vars from the UI
# ---------------------------------------------------------------------------


def _clear_slack_credentials() -> None:
    """Wipe every ``slack`` DataVault connection.

    Removes both the workspace rows (under team_id) and the ``__app__`` row
    holding client_id/signing_secret in a single call.
    """
    clear_channel_credentials(vault_engine="slack")


register_credential_clearer("slack", _clear_slack_credentials)


class SlackConfigPatch(BaseModel):
    client_id: str | None = None
    client_secret: str | None = None
    signing_secret: str | None = None
    app_token: str | None = None


@router.get("/slack/config")
async def slack_get_config():
    """Return whether each Slack app-level credential is set.

    Reads from the ``slack/__app__`` vault entry. Workspace bot tokens live
    under team_id and are surfaced via the channel-status route instead.
    """
    stored = _slack_app_creds()
    flags = {field: bool(stored.get(field)) for field in _SLACK_APP_FIELDS}
    return {
        "client_id_set":      flags["client_id"],
        "client_secret_set":  flags["client_secret"],
        "signing_secret_set": flags["signing_secret"],
        "app_token_set":      flags["app_token"],
        # Webhook OAuth flow needs at minimum client_id + client_secret.
        "install_ready":     flags["client_id"] and flags["client_secret"],
        # Socket Mode just needs the app-level token + an existing bot token
        # (the OAuth callback or a manual save provides bot_token).
        "socket_mode_ready": flags["app_token"],
    }


@router.put("/slack/config")
async def slack_put_config(patch: SlackConfigPatch):
    """Persist Slack OAuth credentials to the DataVault.

    Stored on the ``slack/__app__`` vault entry. Empty strings clear the
    corresponding field. Restart the server (or trigger an adapter refresh)
    for already-instantiated bridges to pick up new secrets — this route
    does not hot-reload the live bridge.
    """
    field_patch: dict[str, str | None] = {
        "client_id":      patch.client_id,
        "client_secret":  patch.client_secret,
        "signing_secret": patch.signing_secret,
        "app_token":      patch.app_token,
    }

    writes: dict[str, str] = {}
    deletes: list[str] = []
    for field, value in field_patch.items():
        if value is None:
            continue   # field not in the patch — leave existing value alone
        trimmed = value.strip()
        if trimmed:
            writes[field] = trimmed
        else:
            deletes.append(field)

    save_credentials(
        "slack",
        APP_ACCOUNT,
        writes=writes,
        deletes=tuple(deletes),
        secure_fields=_SLACK_APP_SECURE,
    )

    return await slack_get_config()


# ---------------------------------------------------------------------------
# OAuth: install + callback
# ---------------------------------------------------------------------------


def _slack_oauth_credentials() -> tuple[str, str]:
    creds = _slack_app_creds()
    cid = (creds.get("client_id") or "").strip()
    secret = (creds.get("client_secret") or "").strip()
    if not cid or not secret:
        raise HTTPException(
            status_code=400,
            detail="Slack client_id and client_secret must be set. Use the Configure panel in Dispatch.",
        )
    return cid, secret


@router.post("/slack/oauth/start")
async def slack_oauth_start(redirect_uri: str = Query(...)):
    """Generate a Slack install URL with a one-shot state nonce."""
    cid, _ = _slack_oauth_credentials()
    state = secrets_mod.token_urlsafe(24)
    issued = datetime.now(timezone.utc).isoformat()

    def _stash(state_dict):
        state_dict[SLACK_OAUTH_STATE_KEY] = {
            "state": state,
            "redirect_uri": redirect_uri,
            "issued_at": issued,
        }
    update_state(_stash)
    params = {
        "client_id": cid,
        "scope": ",".join(SLACK_OAUTH_SCOPES),
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return {"install_url": f"{SLACK_AUTHORIZE_URL}?{urlencode(params)}"}


@router.get("/slack/oauth/callback")
async def slack_oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
):
    """Exchange the temporary code for a bot token; persist via DataVault."""
    cid, csec = _slack_oauth_credentials()
    saved = load_state().get(SLACK_OAUTH_STATE_KEY) or {}
    if not saved or saved.get("state") != state:
        return Response(
            content=html_lib.escape("OAuth state mismatch — please retry."),
            status_code=400,
            media_type="text/html",
        )

    redirect_uri = saved.get("redirect_uri") or ""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            SLACK_TOKEN_URL,
            data={
                "code": code,
                "client_id": cid,
                "client_secret": csec,
                "redirect_uri": redirect_uri,
            },
        )
    result = resp.json()
    if not result.get("ok"):
        return Response(
            content=html_lib.escape(f"Slack OAuth failed: {result.get('error', 'unknown')}"),
            status_code=400,
            media_type="text/html",
        )

    bot_token = result.get("access_token") or ""
    team = (result.get("team") or {}).get("id") or "default"
    # Slack's signing secret is per-app, not per-install — the operator sets
    # it once via the Configure panel (lives on slack/__app__). Stamp a copy
    # onto the workspace row at install time so a later OAuth-only refresh
    # still has the secret available to verify webhooks even if the operator
    # rotates app-level credentials independently.
    signing_secret = (_slack_app_creds().get("signing_secret") or "").strip()
    workspace_writes: dict[str, str] = {"bot_token": bot_token}
    if signing_secret:
        workspace_writes["signing_secret"] = signing_secret
    try:
        save_credentials(
            "slack",
            team,
            writes=workspace_writes,
            secure_fields=_SLACK_WORKSPACE_SECURE,
        )
    except Exception:
        logger.exception("could not store Slack token in DataVault")
        return Response(
            content=html_lib.escape("Token received but vault storage failed."),
            status_code=500,
            media_type="text/html",
        )

    update_state(lambda s: s.pop(SLACK_OAUTH_STATE_KEY, None))  # clear nonce
    body_html = (
        f"<h2>Slack workspace connected</h2>"
        f"<p>Team {html_lib.escape(team)} linked. You can close this window.</p>"
    )
    return Response(content=body_html, media_type="text/html")


# ---------------------------------------------------------------------------
# Events API webhook
# ---------------------------------------------------------------------------


@router.post("/slack/events")
async def slack_events(request: Request):
    """Slack Events API entry point.

    Order of operations matters — signature verification gates everything:
        1. Read raw body (bytes) — needed for signature verify.
        2. Verify signature — reject 401 on mismatch. Runs FIRST so a
           handshake-shaped payload with a bad signature cannot bypass
           the auth check. Slack signs ``url_verification`` requests too,
           so verify-first is safe.
        3. Try handshake (``url_verification``) — return challenge as text.
        4. Parse + dispatch to router via the bridge's ChannelSetup.
    """
    if not _DISPATCH_AVAILABLE:
        raise HTTPException(503, detail="anton dispatch module not available")
    from anton.core.dispatch.registry import get_active_adapter

    adapter = get_active_adapter("slack")
    if adapter is None or not isinstance(adapter, SlackBridge):
        raise HTTPException(503, detail="slack adapter not configured")

    body = await request.body()
    headers_lower = {k.lower(): v for k, v in request.headers.items()}
    query = dict(request.query_params)

    try:
        adapter.verify_signature(body=body, headers=headers_lower)
    except SignatureMismatch as exc:
        logger.warning("slack signature mismatch: %s", exc)
        raise HTTPException(401, detail="signature mismatch") from exc

    handshake = adapter.try_handshake(
        method="POST", body=body, headers=headers_lower, query=query,
    )
    if handshake.handled:
        return Response(
            content=handshake.response_body,
            media_type=handshake.content_type,
            status_code=handshake.status_code,
        )

    events = await adapter.parse_inbound(body=body, headers=headers_lower)
    if events:
        adapter.dispatch_webhook_events(events)
    return {"ok": True, "events": len(events)}
