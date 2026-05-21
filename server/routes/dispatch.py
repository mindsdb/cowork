"""Dispatch control plane — manage agent groups, channels, and wirings.

Read/write the central dispatch SQLite database at
``~/.anton/cowork/dispatch/dispatch.db`` so the desktop UI can show
connected channels and wire agents to messaging groups.

Phase-3 scope (this file):
    - Status + channel-type listing
    - Agent group CRUD
    - Wiring CRUD
    - Read-only views over messaging groups and sessions

Out of scope here (added in later steps):
    - OAuth flows for Slack / WhatsApp (each channel adapter brings its
      own route file modeled on routes/integrations.py)
    - Pairing codes (added with the first webhook channel)
    - Adapter lifecycle (start/stop) — runs at server startup once at
      least one channel adapter is registered
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


DISPATCH_DIR = Path.home() / ".anton" / "cowork" / "dispatch"
DISPATCH_DB_PATH = DISPATCH_DIR / "dispatch.db"
DISPATCH_SESSIONS_DIR = DISPATCH_DIR / "sessions"


# Dispatch runs a single shared agent identity — "Anton". The AgentGroup
# entity and the wiring FK stay in anton.core.dispatch so a future multi-agent
# feature can plug other agents in, but cowork only ever creates/uses this one.
ANTON_AGENT_GROUP_ID = "anton"
ANTON_AGENT_GROUP_NAME = "Anton"


def _managed_workspace_root() -> Path:
    """Base dir for server-managed agent workspaces.

    Mirrors the router's auto-provisioning base so manually-created and
    auto-provisioned agent groups land side by side. ``~/.anton`` is the
    one path that exists and persists identically on the desktop app, the
    web build, and the cloud container (whose only persistent volume is
    mounted there). Overridable with ``ANTON_DISPATCH_WORKSPACE_ROOT`` —
    the same env var ``router._auto_workspace`` honours.
    """
    root = os.environ.get("ANTON_DISPATCH_WORKSPACE_ROOT", "").strip()
    if root:
        return Path(root).expanduser()
    return Path.home() / ".anton" / "dispatch-workspaces"


def _anton_workspace() -> Path:
    """Fixed managed workspace for the single Anton agent group.

    ``<managed-root>/anton`` — the same path the router's ``_auto_workspace``
    resolves, so a group created here and one auto-provisioned by the router
    agree. Server-controlled, so no allowlist check is needed.
    """
    return (_managed_workspace_root() / ANTON_AGENT_GROUP_ID).resolve()


# Lazy singletons — the dispatch repo + router are process-local, fine for the
# cowork single-user gateway. Multi-instance deployments would swap this for a
# managed backend.
_repo: Any = None
_router: Any = None
_orchestrator: Any = None
_delivery_task: Any = None


def _get_repo():
    """Return a process-wide SqliteDispatchRepository, building it on first use."""
    global _repo
    if _repo is None:
        try:
            from anton.core.dispatch.repository import SqliteDispatchRepository
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Anton dispatch module not available: {exc}",
            ) from exc
        DISPATCH_DIR.mkdir(parents=True, exist_ok=True)
        _repo = SqliteDispatchRepository(DISPATCH_DB_PATH, DISPATCH_SESSIONS_DIR)
    return _repo


async def close_repo() -> None:
    """Close the lazy repo; called from the FastAPI shutdown hook."""
    global _repo
    if _repo is not None:
        try:
            await _repo.close()
        finally:
            _repo = None


async def _ensure_single_anton_group(repo: Any) -> None:
    """Guarantee exactly one agent group — "Anton" — and route everything to it.

    Creates the Anton group if missing, then collapses any other agent groups
    (the per-channel groups older builds auto-provisioned) into it, re-pointing
    their wirings and sessions. Idempotent — a no-op once migrated.
    """
    from anton.core.dispatch.entities import AgentGroup
    from anton.core.dispatch.policy import PermissionPolicy

    try:
        await repo.get_agent_group(ANTON_AGENT_GROUP_ID)
    except KeyError:
        workspace = _anton_workspace()
        workspace.mkdir(parents=True, exist_ok=True)
        await repo.create_agent_group(
            AgentGroup(
                id=ANTON_AGENT_GROUP_ID,
                name=ANTON_AGENT_GROUP_NAME,
                workspace=workspace,
                policy=PermissionPolicy(),
            )
        )

    removed = await repo.collapse_to_single_agent_group(ANTON_AGENT_GROUP_ID)
    if removed:
        logger.info(
            "dispatch: collapsed %d legacy agent group(s) into %r",
            removed,
            ANTON_AGENT_GROUP_ID,
        )


# ---------------------------------------------------------------------------
# Dispatch lifecycle — router + orchestrator + adapters + delivery loop
# ---------------------------------------------------------------------------


async def start_dispatch() -> None:
    """Boot the dispatch router, orchestrator, and channel adapters.

    Called from the FastAPI startup hook. Idempotent — safe to invoke twice
    (subsequent calls no-op).
    """
    global _router, _orchestrator, _delivery_task

    if _router is not None:
        return

    try:
        from anton.core.dispatch.local_runtime import LocalScratchpadOrchestrator
        from anton.core.dispatch.registry import init_channel_adapters
        from anton.core.dispatch.router import DispatchRouter
    except ImportError as exc:
        logger.warning("dispatch lifecycle skipped — anton not importable: %s", exc)
        return

    # Importing dispatch_slack triggers SlackBridge factory registration.
    try:
        from . import dispatch_slack  # noqa: F401
    except Exception:
        logger.exception("could not register slack adapter")

    repo = _get_repo()
    await _ensure_single_anton_group(repo)
    orchestrator = LocalScratchpadOrchestrator(
        store_opener=repo.open_session_store,
        # Cowork's tone nudge — same suffix the interactive chat uses.
        system_prompt_suffix=(
            "Replies are delivered through a messaging channel (Slack, WhatsApp, ...). "
            "Keep replies tight and self-contained; the user cannot see your tool work."
        ),
    )
    router = DispatchRouter(repo=repo, runtime=orchestrator)

    try:
        await init_channel_adapters(_make_setup_factory(router))
    except Exception:
        logger.exception("channel adapter init failed; dispatch will run without channels")

    _delivery_task = asyncio.create_task(
        router.run_delivery_loop(),
        name="dispatch-delivery-loop",
    )

    _orchestrator = orchestrator
    _router = router
    logger.info("dispatch started: router + orchestrator + delivery loop running")


async def stop_dispatch() -> None:
    """Tear down the dispatch lifecycle — delivery loop, orchestrator, adapters."""
    global _router, _orchestrator, _delivery_task

    if _delivery_task is not None:
        _delivery_task.cancel()
        try:
            await _delivery_task
        except (asyncio.CancelledError, Exception):
            pass
        _delivery_task = None

    if _orchestrator is not None:
        try:
            await _orchestrator.stop_all()
        except Exception:
            logger.exception("orchestrator.stop_all failed")
        _orchestrator = None

    try:
        from anton.core.dispatch.registry import shutdown_channel_adapters
        await shutdown_channel_adapters()
    except Exception:
        logger.debug("channel adapter shutdown failed", exc_info=True)

    _router = None


def _make_setup_factory(router: Any):
    """Build the ``setup_factory`` that ``init_channel_adapters`` expects.

    Each adapter is handed a :class:`ChannelSetup` wired to the shared
    router. Extracted to module scope so both :func:`start_dispatch` and
    :func:`reload_dispatch` build adapters the same way.
    """
    from anton.core.dispatch.adapter import ChannelSetup

    def _setup_for(adapter: Any) -> Any:
        return ChannelSetup(
            on_inbound=router.on_inbound,
            on_metadata=_noop_metadata,
            on_action_response=getattr(router, "handle_action_response", _noop_action),
        )

    return _setup_for


async def reload_dispatch() -> list[str]:
    """Re-initialize channel adapters from current credentials.

    Lets the UI apply saved or cleared channel credentials without a server
    restart: every live adapter is stopped, then the registry factories are
    re-run — they re-read the vault + env on each call, so a freshly
    configured channel comes online and a disconnected one stays down. The
    router, orchestrator, and delivery loop are left running untouched.

    Returns the channel types active after the reload.
    """
    if _router is None:
        # Dispatch never came up this process (anton missing at boot, a
        # prior failure, ...) — a reload is then just a first start.
        await start_dispatch()
    else:
        try:
            from anton.core.dispatch.registry import (
                init_channel_adapters,
                shutdown_channel_adapters,
            )
        except ImportError as exc:
            raise HTTPException(
                status_code=503, detail=f"dispatch module unavailable: {exc}"
            ) from exc
        await shutdown_channel_adapters()
        try:
            await init_channel_adapters(_make_setup_factory(_router))
        except Exception:
            logger.exception("dispatch reload: channel adapter init failed")

    try:
        from anton.core.dispatch.registry import get_active_adapters
        return sorted(a.channel_type for a in get_active_adapters())
    except Exception:
        return []


async def _noop_metadata(addr: Any, meta: dict) -> None:
    """Default ChannelSetup.on_metadata when no metadata pipeline is wired."""


async def _noop_action(response: Any) -> None:
    """Default ChannelSetup.on_action_response — action cards are step-6 work."""


# ---------------------------------------------------------------------------
# Disconnect — stop a channel adapter and clear its stored connection
# ---------------------------------------------------------------------------

# Channel modules register a credential-clearer here at import time so the
# generic disconnect endpoints can wipe per-channel secrets without dispatch.py
# needing to know each channel's env-var / vault layout.
_credential_clearers: dict[str, Any] = {}


def register_credential_clearer(channel_type: str, clearer: Any) -> None:
    """Register a no-arg callable that wipes one channel's stored credentials.

    Called at import time by each channel module. ``clearer`` deletes the
    channel's env vars (process + ``~/.anton/.env``) and its DataVault
    connections; :func:`_disconnect_channel` invokes it.
    """
    _credential_clearers[channel_type] = clearer


def clear_channel_credentials(
    *,
    fixed_keys: tuple[str, ...],
    env_prefix: str,
    vault_engine: str,
) -> None:
    """Wipe a channel's stored credentials — env vars and DataVault entries.

    Deletes ``fixed_keys`` plus any ``~/.anton/.env`` or process-env var
    starting with ``env_prefix`` (covers the ``DS_<ENGINE>_<ACCOUNT>__*``
    vars the adapters mint), then removes every ``vault_engine`` connection.
    Channel modules call this from the clearer they register.
    """
    from .settings import _read_dotenv, _write_dotenv, GLOBAL_ENV_PATH

    existing = _read_dotenv(GLOBAL_ENV_PATH)
    keys = set(fixed_keys)
    keys.update(k for k in existing if k.startswith(env_prefix))
    keys.update(k for k in os.environ if k.startswith(env_prefix))
    _write_dotenv(GLOBAL_ENV_PATH, {}, delete_keys=tuple(sorted(keys)))
    for key in keys:
        os.environ.pop(key, None)

    try:
        from anton.core.datasources.data_vault import LocalDataVault
        vault = LocalDataVault()
        for conn in vault.list_connections():
            if conn.get("engine") == vault_engine and conn.get("name"):
                vault.delete(vault_engine, conn["name"])
    except Exception:
        logger.debug(
            "could not clear %s vault connections", vault_engine, exc_info=True
        )


async def _remove_channel_wirings(channel_type: str) -> int:
    """Delete every wiring whose messaging group belongs to ``channel_type``."""
    repo = _get_repo()
    mg_ids = {
        mg.id
        for mg in await repo.list_messaging_groups()
        if mg.channel_type == channel_type
    }
    if not mg_ids:
        return 0
    removed = 0
    for w in await repo.list_wirings():
        if w.messaging_group_id in mg_ids:
            if await repo.delete_wiring(w.messaging_group_id, w.agent_group_id):
                removed += 1
    return removed


async def _disconnect_channel(channel_type: str) -> dict[str, Any]:
    """Tear a channel down: stop its adapter, clear credentials, drop wirings."""
    # 1. Stop the running adapter (best-effort — it may not be active).
    adapter_stopped = False
    try:
        from anton.core.dispatch.registry import shutdown_channel_adapter
        adapter_stopped = await shutdown_channel_adapter(channel_type)
    except Exception:
        logger.exception("disconnect: failed to stop %s adapter", channel_type)

    # 2. Wipe stored credentials (env vars + vault) via the channel's clearer.
    credentials_cleared = False
    clearer = _credential_clearers.get(channel_type)
    if clearer is not None:
        try:
            clearer()
            credentials_cleared = True
        except Exception:
            logger.exception(
                "disconnect: failed to clear %s credentials", channel_type
            )

    # 3. Remove wirings that routed this channel — a wiring with no live
    #    channel is dead, so disconnecting clears them too.
    wirings_removed = 0
    try:
        wirings_removed = await _remove_channel_wirings(channel_type)
    except Exception:
        logger.exception("disconnect: failed to remove %s wirings", channel_type)

    logger.info(
        "dispatch: disconnected %s (adapter_stopped=%s, credentials_cleared=%s, "
        "wirings_removed=%d)",
        channel_type, adapter_stopped, credentials_cleared, wirings_removed,
    )
    return {
        "channel_type": channel_type,
        "adapter_stopped": adapter_stopped,
        "credentials_cleared": credentials_cleared,
        "wirings_removed": wirings_removed,
    }


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _agent_group_dto(g: Any) -> dict[str, Any]:
    return {
        "id": g.id,
        "name": g.name,
        "workspace": str(g.workspace),
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "policy": _policy_dto(g.policy),
    }


def _policy_dto(p: Any) -> dict[str, Any]:
    return {
        "file_scopes": [{"path": s.path, "mode": s.mode} for s in p.file_scopes],
        "network_allowlist": list(p.network_allowlist),
        "mcp_allowlist": list(p.mcp_allowlist),
        "act_without_asking": p.act_without_asking,
        "require_approval_for_destructive": p.require_approval_for_destructive,
        "scheduled_dispatch_allowed": p.scheduled_dispatch_allowed,
        "scheduled_destructive_blocked": p.scheduled_destructive_blocked,
    }


def _messaging_group_dto(mg: Any) -> dict[str, Any]:
    return {
        "id": mg.id,
        "channel_type": mg.channel_type,
        "platform_id": mg.platform_id,
        "display_name": mg.display_name,
        "is_group": mg.is_group,
        "created_at": mg.created_at.isoformat() if mg.created_at else None,
    }


def _wiring_dto(w: Any) -> dict[str, Any]:
    return {
        "messaging_group_id": w.messaging_group_id,
        "agent_group_id": w.agent_group_id,
        "session_mode": w.session_mode.value,
        "trigger_rule": w.trigger_rule.value,
        "trigger_pattern": w.trigger_pattern,
        "priority": w.priority,
    }


def _session_dto(s: Any) -> dict[str, Any]:
    return {
        "id": s.id,
        "agent_group_id": s.agent_group_id,
        "session_key": s.session_key,
        "store_path": str(s.store_path),
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "last_active_at": s.last_active_at.isoformat() if s.last_active_at else None,
    }


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class WiringCreate(BaseModel):
    """Wire a messaging group to the Anton agent.

    Provide either ``messaging_group_id`` (existing) or
    ``channel_type`` + ``platform_id`` (creates the messaging group on demand).
    The latter is the natural shape from the UI — operators know
    "slack channel C123" not "mg uuid".

    ``agent_group_id`` defaults to the single shared Anton group; it stays in
    the model so the entity FK is still expressible for a future multi-agent
    feature, but the UI never sets it.
    """
    agent_group_id: str = ANTON_AGENT_GROUP_ID
    messaging_group_id: Optional[str] = None
    channel_type: Optional[str] = None
    platform_id: Optional[str] = None
    session_mode: str = "per-messaging-group"   # AGENT_SHARED | PER_MESSAGING_GROUP | PER_THREAD
    trigger_rule: str = "always"                 # ALWAYS | MENTION_ONLY | REGEX
    trigger_pattern: Optional[str] = None
    priority: int = 100


# ---------------------------------------------------------------------------
# Status + channel listing
# ---------------------------------------------------------------------------


@router.get("/status")
async def status():
    """High-level dispatch status — does the repo open, how many channels are registered."""
    try:
        repo = _get_repo()
        agent_groups = await repo.list_agent_groups()
        wirings = await repo.list_wirings()
    except HTTPException as exc:
        return {
            "ready": False,
            "error": exc.detail,
            "registered_channels": [],
            "active_channels": [],
            "agent_group_count": 0,
            "wiring_count": 0,
        }

    try:
        from anton.core.dispatch.registry import (
            get_active_adapters,
            get_registered_channel_types,
        )
        registered = sorted(get_registered_channel_types())
        active = sorted(a.channel_type for a in get_active_adapters())
    except Exception:
        registered, active = [], []

    return {
        "ready": True,
        "db_path": str(DISPATCH_DB_PATH),
        "registered_channels": registered,
        "active_channels": active,
        "agent_group_count": len(agent_groups),
        "wiring_count": len(wirings),
    }


@router.get("/channels")
async def list_channels():
    """Channel types currently registered (have an adapter factory) and active (ready)."""
    try:
        from anton.core.dispatch.registry import (
            get_active_adapters,
            get_registered_channel_types,
        )
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"dispatch module unavailable: {exc}") from exc

    active_set = {a.channel_type for a in get_active_adapters()}
    return {
        "channels": [
            {
                "type": ct,
                "registered": True,
                "active": ct in active_set,
            }
            for ct in sorted(get_registered_channel_types())
        ]
    }


# ---------------------------------------------------------------------------
# Disconnect endpoints
# ---------------------------------------------------------------------------


@router.post("/channels/{channel_type}/disconnect")
async def disconnect_channel(channel_type: str):
    """Disconnect one channel — stop its adapter, clear credentials, drop wirings.

    Sticky: the stored credentials are deleted, so the channel stays down
    across a server restart until it is reconfigured.
    """
    if channel_type not in _credential_clearers:
        raise HTTPException(
            status_code=404, detail=f"unknown channel type: {channel_type}"
        )
    return await _disconnect_channel(channel_type)


@router.post("/disconnect-all")
async def disconnect_all_channels():
    """Disconnect every channel — a full dispatch reset.

    Stops all adapters, clears all channel credentials, and removes all
    wirings. Sessions and message history are left intact.
    """
    results = [
        await _disconnect_channel(channel_type)
        for channel_type in sorted(_credential_clearers)
    ]
    return {"disconnected": results}


@router.post("/reload")
async def reload_channels():
    """Re-initialize every channel adapter from current credentials.

    Applies channel config changes (saved or cleared) live, without a
    server restart — a just-configured channel comes online, a
    disconnected one stays down. Returns the channel types now active.
    """
    active = await reload_dispatch()
    return {"reloaded": True, "active_channels": active}


# ---------------------------------------------------------------------------
# Agent groups
# ---------------------------------------------------------------------------


@router.get("/agent-groups")
async def list_agent_groups():
    repo = _get_repo()
    groups = await repo.list_agent_groups()
    return {"agent_groups": [_agent_group_dto(g) for g in groups]}


# Agent groups are created and managed server-side — a single shared "Anton"
# group, ensured at startup by _ensure_single_anton_group. There is no
# create/delete endpoint: the UI no longer exposes per-agent management.


# ---------------------------------------------------------------------------
# Wirings
# ---------------------------------------------------------------------------


@router.get("/wirings")
async def list_wirings():
    repo = _get_repo()
    wirings = await repo.list_wirings()
    return {"wirings": [_wiring_dto(w) for w in wirings]}


@router.post("/wirings")
async def create_wiring(body: WiringCreate):
    from anton.core.dispatch.entities import (
        MessagingGroupAgent,
        SessionMode,
        TriggerRule,
    )

    try:
        session_mode = SessionMode(body.session_mode)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"invalid session_mode '{body.session_mode}'",
        ) from exc
    try:
        trigger_rule = TriggerRule(body.trigger_rule)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"invalid trigger_rule '{body.trigger_rule}'",
        ) from exc

    repo = _get_repo()
    # Validate the agent group exists.
    try:
        await repo.get_agent_group(body.agent_group_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Resolve the messaging group: explicit id wins; otherwise create from (type, platform_id).
    if body.messaging_group_id:
        existing = next(
            (mg for mg in await repo.list_messaging_groups() if mg.id == body.messaging_group_id),
            None,
        )
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail=f"messaging_group not found: {body.messaging_group_id}",
            )
        mg_id = existing.id
    elif body.channel_type and body.platform_id:
        mg = await repo.get_or_create_messaging_group(body.channel_type, body.platform_id)
        mg_id = mg.id
    else:
        raise HTTPException(
            status_code=400,
            detail="must provide either messaging_group_id, or both channel_type and platform_id",
        )

    wiring = MessagingGroupAgent(
        messaging_group_id=mg_id,
        agent_group_id=body.agent_group_id,
        session_mode=session_mode,
        trigger_rule=trigger_rule,
        trigger_pattern=body.trigger_pattern,
        priority=body.priority,
    )
    await repo.add_wiring(wiring)
    return {"wiring": _wiring_dto(wiring)}


@router.delete("/wirings/{messaging_group_id}/{agent_group_id}")
async def delete_wiring(messaging_group_id: str, agent_group_id: str):
    repo = _get_repo()
    deleted = await repo.delete_wiring(messaging_group_id, agent_group_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"wiring not found: {messaging_group_id} → {agent_group_id}",
        )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Read-only views
# ---------------------------------------------------------------------------


@router.get("/messaging-groups")
async def list_messaging_groups():
    """Messaging groups created so far — populated lazily as inbound events arrive."""
    repo = _get_repo()
    mgs = await repo.list_messaging_groups()
    return {"messaging_groups": [_messaging_group_dto(mg) for mg in mgs]}


@router.get("/sessions")
async def list_sessions(agent_group_id: Optional[str] = None):
    repo = _get_repo()
    sessions = await repo.list_sessions(agent_group_id=agent_group_id)
    return {"sessions": [_session_dto(s) for s in sessions]}
