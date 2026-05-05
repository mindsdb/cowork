"""Slack channel adapter + HTTP routes (OAuth install + Events API webhook).

Components:
    SlackBridge       — concrete :class:`ChatBridgeBase` that also satisfies
                        :class:`anton.core.dispatch.adapter.ChannelAdapter`,
                        so the dispatch registry can hand it to the router.
    OAuth start/cb    — install URL + token-exchange callback; tokens land in
                        ``DS_SLACK_<ACCOUNT>__BOT_TOKEN`` and
                        ``DS_SLACK_<ACCOUNT>__SIGNING_SECRET`` via DataVault.
    POST /events      — Events API webhook. Handles ``url_verification`` and
                        ``event_callback`` envelopes, dispatches inbound
                        messages to the dispatch router via the bridge.

Environment expected:
    SLACK_CLIENT_ID, SLACK_CLIENT_SECRET — set by the operator before the
    OAuth install flow can run. Read at start time, not module load.
"""
from __future__ import annotations

import html as html_lib
import json
import logging
import os
import secrets as secrets_mod
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request as URLRequest, urlopen

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

from anton.core.dispatch.adapter import (
    ChannelAdapter,
    ChannelSetup,
    InboundEvent,
    InboundMessage,
    OutboundMessage,
    PlatformAddress,
)
from anton.core.dispatch.registry import register_channel_adapter

from channels import (
    ChatBridgeBase,
    SignatureMismatch,
    WebhookHandshake,
    load_channel_secrets,
    verify_slack,
)
from .cowork_state import load_state, update_state
from .settings import _read_dotenv, _write_dotenv, GLOBAL_ENV_PATH

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

    # -----------------------------------------------------------------
    # ChannelAdapter Protocol
    # -----------------------------------------------------------------

    async def setup(self, setup: ChannelSetup) -> None:
        self._setup = setup
        logger.info("SlackBridge ready for account=%s", self.account)

    async def shutdown(self) -> None:
        self._setup = None

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

    async def dispatch_webhook_events(self, events: list[InboundEvent]) -> None:
        """Forward parsed events to the router via the cached ``ChannelSetup``."""
        if self._setup is None:
            logger.warning("SlackBridge received events before setup completed")
            return
        for event in events:
            try:
                await self._setup.on_inbound(event)
            except Exception:
                logger.exception("router.on_inbound raised for slack event %s", event.message.id)

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

        event = data.get("event") or {}
        kind = event.get("type")
        if kind not in ("message", "app_mention"):
            return []
        # Skip bot echoes, edits, deletes, threaded broadcast subtypes.
        if event.get("bot_id") or event.get("subtype") in (
            "bot_message",
            "message_changed",
            "message_deleted",
        ):
            return []

        text = event.get("text", "") or ""
        channel = event.get("channel", "") or ""
        thread_ts = event.get("thread_ts")  # None for top-level messages
        ts = event.get("ts", "") or ""
        user = event.get("user", "") or None

        try:
            timestamp = datetime.fromtimestamp(float(ts), timezone.utc) if ts else datetime.now(timezone.utc)
        except (TypeError, ValueError):
            timestamp = datetime.now(timezone.utc)

        is_group = not channel.startswith("D")

        return [
            InboundEvent(
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
        ]

    async def send_text(self, *, address: PlatformAddress, text: str) -> str:
        """Post a single chunk via Slack's ``chat.postMessage``."""
        bot_token = self.secrets.get("bot_token") or ""
        if not bot_token:
            raise RuntimeError("slack bot_token not configured")
        payload: dict[str, Any] = {
            "channel": address.platform_id,
            "text": text,
        }
        if address.thread_id:
            payload["thread_ts"] = address.thread_id

        result = await self._call_web_api("chat.postMessage", payload, bot_token=bot_token)
        if not result.get("ok"):
            raise RuntimeError(f"slack chat.postMessage failed: {result.get('error')}")
        return str(result.get("ts", ""))

    # -----------------------------------------------------------------
    # Internal: thin Slack Web API client
    # -----------------------------------------------------------------

    @staticmethod
    async def _call_web_api(method: str, payload: dict[str, Any], *, bot_token: str) -> dict[str, Any]:
        """Synchronous urllib call wrapped in to_thread. v2 can swap to httpx."""
        import asyncio

        body = json.dumps(payload).encode("utf-8")
        req = URLRequest(
            f"{SLACK_API_BASE}/{method}",
            data=body,
            headers={
                "Authorization": f"Bearer {bot_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )

        def _do() -> dict[str, Any]:
            with urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))

        return await asyncio.to_thread(_do)


# ---------------------------------------------------------------------------
# Adapter registration — runs on import so the registry sees Slack as a
# registered channel even before OAuth is finished.
# ---------------------------------------------------------------------------


async def _slack_adapter_factory() -> ChannelAdapter | None:
    """Build a SlackBridge if credentials are present; return None otherwise."""
    account = os.environ.get("ANTON_SLACK_ACCOUNT", "default")
    creds = load_channel_secrets("slack", account)
    if not creds.get("bot_token") or not creds.get("signing_secret"):
        return None
    return SlackBridge(account=account, channel_secrets=creds)


register_channel_adapter("slack", _slack_adapter_factory)


# ---------------------------------------------------------------------------
# Config panel — read/write Slack OAuth env vars from the UI
# ---------------------------------------------------------------------------


SLACK_ENV_KEYS = ("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET")


class SlackConfigPatch(BaseModel):
    client_id: str | None = None
    client_secret: str | None = None
    signing_secret: str | None = None


def _slack_env_value(key: str) -> str:
    """Resolve a Slack env var from process env first, then ~/.anton/.env."""
    val = os.environ.get(key, "").strip()
    if val:
        return val
    return _read_dotenv(GLOBAL_ENV_PATH).get(key, "").strip()


@router.get("/slack/config")
async def slack_get_config():
    """Return whether each Slack env var is set. Never returns the values themselves."""
    flags = {key: bool(_slack_env_value(key)) for key in SLACK_ENV_KEYS}
    return {
        "client_id_set": flags["SLACK_CLIENT_ID"],
        "client_secret_set": flags["SLACK_CLIENT_SECRET"],
        "signing_secret_set": flags["SLACK_SIGNING_SECRET"],
        "install_ready": flags["SLACK_CLIENT_ID"] and flags["SLACK_CLIENT_SECRET"],
    }


@router.put("/slack/config")
async def slack_put_config(patch: SlackConfigPatch):
    """Persist Slack OAuth credentials to ~/.anton/.env and mirror to os.environ.

    Empty strings clear the corresponding key. Restart the server (or trigger an
    adapter refresh elsewhere) for already-instantiated bridges to pick up new
    secrets — this route does not hot-reload the live bridge.
    """
    fields: dict[str, str | None] = {
        "SLACK_CLIENT_ID":      patch.client_id,
        "SLACK_CLIENT_SECRET":  patch.client_secret,
        "SLACK_SIGNING_SECRET": patch.signing_secret,
    }

    writes: dict[str, str] = {}
    deletes: list[str] = []
    for key, value in fields.items():
        if value is None:
            continue   # field not in the patch — leave existing value alone
        trimmed = value.strip()
        if trimmed:
            writes[key] = trimmed
        else:
            deletes.append(key)

    _write_dotenv(GLOBAL_ENV_PATH, writes, delete_keys=tuple(deletes))

    # Mirror writes into the running process so the OAuth start route works
    # immediately, without a server restart.
    os.environ.update(writes)
    for key in deletes:
        os.environ.pop(key, None)

    return await slack_get_config()


# ---------------------------------------------------------------------------
# OAuth: install + callback
# ---------------------------------------------------------------------------


def _slack_oauth_credentials() -> tuple[str, str]:
    cid = _slack_env_value("SLACK_CLIENT_ID")
    secret = _slack_env_value("SLACK_CLIENT_SECRET")
    if not cid or not secret:
        raise HTTPException(
            status_code=400,
            detail="SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set. Use the Configure panel in Dispatch.",
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
    body = urlencode(
        {"code": code, "client_id": cid, "client_secret": csec, "redirect_uri": redirect_uri}
    ).encode("utf-8")
    req = URLRequest(SLACK_TOKEN_URL, data=body)

    import asyncio
    def _do() -> dict[str, Any]:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))

    result = await asyncio.to_thread(_do)
    if not result.get("ok"):
        return Response(
            content=html_lib.escape(f"Slack OAuth failed: {result.get('error', 'unknown')}"),
            status_code=400,
            media_type="text/html",
        )

    bot_token = result.get("access_token") or ""
    team = (result.get("team") or {}).get("id") or "default"
    # Slack's signing secret is per-app, not per-install — the operator must
    # set it once via env var or settings; we don't get it from OAuth.
    # Persist only the bot token here.
    try:
        from anton.core.datasources.data_vault import LocalDataVault

        vault = LocalDataVault()
        existing = vault.load("slack", team) or {}
        existing.setdefault("signing_secret", os.environ.get("SLACK_SIGNING_SECRET", ""))
        existing["bot_token"] = bot_token
        vault.save("slack", team, existing)
        vault.inject_env("slack", team)
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

    Order of operations matters:
        1. Read raw body (bytes) — needed for signature verify.
        2. Try handshake (url_verification) — return challenge as text.
        3. Verify signature — reject 401 on mismatch.
        4. Parse + dispatch to router via the bridge's ChannelSetup.
    """
    from anton.core.dispatch.registry import get_active_adapter

    adapter = get_active_adapter("slack")
    if adapter is None or not isinstance(adapter, SlackBridge):
        raise HTTPException(503, detail="slack adapter not configured")

    body = await request.body()
    headers_lower = {k.lower(): v for k, v in request.headers.items()}
    query = dict(request.query_params)

    handshake = adapter.try_handshake(
        method="POST", body=body, headers=headers_lower, query=query,
    )
    if handshake.handled:
        return Response(
            content=handshake.response_body,
            media_type=handshake.content_type,
            status_code=handshake.status_code,
        )

    try:
        adapter.verify_signature(body=body, headers=headers_lower)
    except SignatureMismatch as exc:
        logger.warning("slack signature mismatch: %s", exc)
        raise HTTPException(401, detail="signature mismatch") from exc

    events = await adapter.parse_inbound(body=body, headers=headers_lower)
    if events:
        await adapter.dispatch_webhook_events(events)
    return {"ok": True, "events": len(events)}
