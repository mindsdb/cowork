"""Conversation lifecycle manager.

Owns:
  - The in-memory pool of live ChatSession instances (capped, evicted oldest).
  - The "build a ChatSession for this project" recipe that cowork was
    using inside anton_bridge._build_chat_session.
  - On-disk history persistence (delegated to anton.memory.HistoryStore).
  - Conversation metadata (id / title / turns / preview / created_at /
    updated_at / project) persisted alongside history.

The public API is small:
  - chat_stream(input, conversation_id, project, model)        → (stream, id)
  - list_conversations(limit, project)
  - get_conversation(id)
  - get_messages(id)
  - update_conversation(id, **patch)
  - delete_conversation(id)
  - close_all()
  - is_anton_available()

A "project" is a folder name under projects_store.projects_dir(); the actual
filesystem path is resolved internally. Passing project=None means "active
project."

Internally the live cache calls a Python class still named ChatSession
because that's anton-core's name. The API noun is "conversation."
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, AsyncIterator, Optional

from anton_api import projects_store


logger = logging.getLogger(__name__)


MAX_CONVERSATIONS = int(os.environ.get("ANTON_SERVER_MAX_CONVERSATIONS", "3"))


ANTON_AVAILABLE = False

try:  # pragma: no cover - import guard
    import anton  # noqa: F401

    ANTON_AVAILABLE = True
    logger.info("Anton is available; using real ChatSession instances")
except ImportError:  # pragma: no cover
    logger.info("Anton not installed; conversation backend is unavailable")


class AntonConfigurationError(RuntimeError):
    """Raised when Anton cannot run because setup is missing or invalid."""


class AntonRuntimeError(RuntimeError):
    """Raised when a real Anton session fails after configuration passes."""


def is_anton_available() -> bool:
    return ANTON_AVAILABLE


# ---------------------------------------------------------------------------
# Storage layout
# ---------------------------------------------------------------------------


def _project_base(project: Optional[str]) -> Path:
    """Resolve project name → filesystem path. None ⇒ active project."""
    _, base = projects_store.resolve_project(project)
    return base


def _episodes_dir(project: Optional[str]) -> Path:
    return _project_base(project) / ".anton" / "episodes"


def _meta_path(project: Optional[str], conversation_id: str) -> Path:
    return _episodes_dir(project) / f"{conversation_id}_meta.json"


def _history_path(project: Optional[str], conversation_id: str) -> Path:
    return _episodes_dir(project) / f"{conversation_id}_history.json"


# ---------------------------------------------------------------------------
# Metadata persistence
# ---------------------------------------------------------------------------


def _new_conversation_id() -> str:
    return (
        datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        + "_"
        + uuid.uuid4().hex[:6]
    )


def _atomic_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _load_meta(project: Optional[str], conversation_id: str) -> dict | None:
    path = _meta_path(project, conversation_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_meta(project: Optional[str], conversation_id: str, meta: dict) -> None:
    try:
        _atomic_write(_meta_path(project, conversation_id), meta)
    except Exception:
        logger.debug("Could not persist conversation meta", exc_info=True)


def _load_history(project: Optional[str], conversation_id: str) -> list[dict] | None:
    path = _history_path(project, conversation_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else None
    except Exception:
        return None


def _ensure_meta(
    project: Optional[str],
    conversation_id: str,
) -> dict:
    meta = _load_meta(project, conversation_id)
    if meta:
        return meta
    now = datetime.now(timezone.utc).isoformat()
    name, _ = projects_store.resolve_project(project)
    meta = {
        "id": conversation_id,
        "title": "",
        "turns": 0,
        "preview": "",
        "created_at": now,
        "updated_at": now,
        "project": name,
    }
    _save_meta(project, conversation_id, meta)
    return meta


def _update_meta_after_turn(
    project: Optional[str],
    conversation_id: str,
    history: list[dict],
) -> None:
    meta = _load_meta(project, conversation_id) or {}
    if not meta.get("created_at"):
        meta["created_at"] = datetime.now(timezone.utc).isoformat()
    meta["id"] = conversation_id
    if not meta.get("project"):
        try:
            meta["project"], _ = projects_store.resolve_project(project)
        except FileNotFoundError:
            pass
    meta["turns"] = sum(1 for m in history if m.get("role") == "user")
    preview = ""
    for m in history:
        if m.get("role") == "user":
            content = m.get("content", "")
            if isinstance(content, str):
                preview = content.strip()[:60]
            break
    meta["preview"] = preview
    if not meta.get("title") or meta.get("title") == conversation_id:
        if preview:
            meta["title"] = preview[:50] + ("..." if len(preview) > 50 else "")
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_meta(project, conversation_id, meta)


# ---------------------------------------------------------------------------
# ChatSession construction (lifted from cowork's anton_bridge._build_chat_session)
# ---------------------------------------------------------------------------


async def _build_chat_session(
    conversation_id: str,
    project: Optional[str],
    model: Optional[str],
):
    """Build the same core runtime the Anton CLI uses, scoped to one project."""
    from anton.chat_session import build_runtime_context
    from anton.config.settings import AntonSettings
    from anton.context.self_awareness import SelfAwarenessContext
    from anton.core.llm.client import LLMClient
    from anton.core.memory.cortex import Cortex
    from anton.core.memory.episodes import EpisodicMemory
    from anton.core.memory.hippocampus import Hippocampus
    from anton.core.session import ChatSession, ChatSessionConfig, SystemPromptContext
    from anton.memory.history_store import HistoryStore
    from anton.tools import CONNECT_DATASOURCE_TOOL, PUBLISH_TOOL
    from anton.workspace import Workspace

    try:
        from anton.core.datasources.data_vault import LocalDataVault
    except Exception:  # pragma: no cover
        LocalDataVault = None

    base = _project_base(project)
    settings = AntonSettings()
    settings.resolve_workspace(str(base))
    if model:
        settings.planning_model = model

    workspace = Workspace(base)
    workspace.initialize()
    workspace.apply_env_to_process()

    anton_dir = base / ".anton"
    output_dir = Path(settings.output_dir)
    context_dir = Path(settings.context_dir)
    episodes_dir = anton_dir / "episodes"
    project_memory_dir = anton_dir / "memory"
    for directory in (output_dir, context_dir, episodes_dir, project_memory_dir):
        directory.mkdir(parents=True, exist_ok=True)

    llm_client = LLMClient.from_settings(settings)
    self_awareness = SelfAwarenessContext(context_dir)
    global_memory_dir = Path.home() / ".anton" / "memory"
    global_memory_dir.mkdir(parents=True, exist_ok=True)
    cortex = Cortex(
        global_hc=Hippocampus(global_memory_dir),
        project_hc=Hippocampus(project_memory_dir),
        mode=settings.memory_mode if settings.memory_enabled else "off",
        llm_client=llm_client,
    )
    episodic = EpisodicMemory(episodes_dir, enabled=settings.episodic_memory)
    episodic.resume_session(conversation_id)
    history_store = HistoryStore(episodes_dir)
    initial_history = history_store.load(conversation_id)
    output_context = (
        f"Save generated files and dashboards to `{output_dir}`. "
        "When you create a user-facing HTML dashboard or report, save it there."
    )

    data_vault = LocalDataVault() if LocalDataVault is not None else None
    google_drive_oauth_connected = False
    if data_vault is not None:
        try:
            for conn in data_vault.list_connections():
                engine = conn.get("engine")
                name = conn.get("name")
                if engine and name:
                    data_vault.inject_env(engine, name)
                    if engine == "google_drive":
                        fields = data_vault.load(engine, name) or {}
                        if fields.get("auth_type") == "oauth":
                            google_drive_oauth_connected = True
        except Exception:
            logger.debug("Could not inject Anton data vault env", exc_info=True)

    integration_guidance = ""
    if google_drive_oauth_connected:
        integration_guidance = (
            " Connected Google Drive accounts are available through Google OAuth credentials "
            "in the injected `DS_GOOGLE_DRIVE_<CONNECTION>__...` environment variables. "
            "Only claim Google Drive access if you can actually use those credentials successfully."
        )

    config = ChatSessionConfig(
        llm_client=llm_client,
        settings=settings,
        self_awareness=self_awareness,
        cortex=cortex,
        episodic=episodic,
        system_prompt_context=SystemPromptContext(
            runtime_context=build_runtime_context(settings),
            suffix=(
                "The Anton CoWork desktop UI displays progress, tool usage, and actions "
                "as separate structured activity rows. Keep assistant text focused on the "
                "user-facing answer; do not narrate internal work with status phrases like "
                "\"I'll check\", \"let me query\", or \"I have access\" unless that wording "
                "is itself the final answer the user needs."
                f"{integration_guidance}"
            ),
            output_context=output_context,
        ),
        workspace=workspace,
        data_vault=data_vault,
        initial_history=initial_history,
        history_store=history_store,
        session_id=conversation_id,
        proactive_dashboards=settings.proactive_dashboards,
        tools=[CONNECT_DATASOURCE_TOOL, PUBLISH_TOOL],
    )
    return ChatSession(config)


def _safe_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    for key in ("ANTON_ANTHROPIC_API_KEY", "ANTON_OPENAI_API_KEY", "ANTON_MINDS_API_KEY"):
        value = os.environ.get(key) or ""
        if value:
            message = message.replace(value, "[redacted]")
    return message


# ---------------------------------------------------------------------------
# In-memory pool
# ---------------------------------------------------------------------------


_live: dict[str, dict[str, Any]] = {}
# entry shape: {"session": ChatSession, "project": str|None}


def list_live() -> list[str]:
    return list(_live.keys())


async def close_all() -> None:
    for cid in list(_live):
        entry = _live.pop(cid, None)
        if not entry:
            continue
        session = entry.get("session")
        if session is None:
            continue
        try:
            await session.close()
        except Exception:
            logger.debug("Failed to close conversation %s", cid, exc_info=True)


def _evict_oldest() -> None:
    if _live:
        oldest = next(iter(_live))
        _live.pop(oldest, None)


async def _resolve_session(
    conversation_id: str,
    project: Optional[str],
    model: Optional[str],
):
    if conversation_id in _live:
        return _live[conversation_id]["session"]

    if len(_live) >= MAX_CONVERSATIONS:
        _evict_oldest()

    session = await _build_chat_session(conversation_id, project, model)
    _live[conversation_id] = {"session": session, "project": project}
    return session


# ---------------------------------------------------------------------------
# Public chat API
# ---------------------------------------------------------------------------


async def chat_stream(
    user_input: str,
    *,
    conversation_id: Optional[str] = None,
    project: Optional[str] = None,
    model: Optional[str] = None,
) -> tuple[AsyncIterator, str]:
    """Run one turn against a conversation, returning (event_stream, conversation_id).

    `project` is a project name (folder under projects_store.projects_dir());
    None resolves to the active project. Raises AntonConfigurationError if
    Anton isn't installed or configuration is incomplete; the caller maps
    that to an SSE failed event. Wraps mid-turn failures in AntonRuntimeError
    with secrets redacted.
    """
    if not ANTON_AVAILABLE:
        raise AntonConfigurationError(
            "Anton is not installed in this desktop environment."
        )

    # Defer config check to the route layer (it has access to get_config_status)
    # so this module stays free of cowork-route imports.

    cid = conversation_id or _new_conversation_id()
    _ensure_meta(project, cid)

    session = await _resolve_session(cid, project, model)

    async def _stream() -> AsyncGenerator:
        try:
            async for event in session.turn_stream(user_input):
                yield event
        except Exception as exc:
            logger.exception("Conversation %s failed", cid)
            raise AntonRuntimeError(_safe_error(exc)) from exc
        finally:
            try:
                _update_meta_after_turn(project, cid, session.history)
            except Exception:
                logger.debug("Could not update conversation meta", exc_info=True)

    return _stream(), cid


# ---------------------------------------------------------------------------
# Conversation CRUD (purely on-disk; live cache is unaffected)
# ---------------------------------------------------------------------------


def _candidate_episode_dirs(project: Optional[str] = None) -> list[tuple[str, Path]]:
    """Episode dirs to scan, paired with project name.

    project=None     → every registered project
    project="all"    → every registered project (alias)
    project="<name>" → just that one (silent skip if missing)
    """
    if project and project != "all":
        try:
            name, base = projects_store.resolve_project(project)
        except FileNotFoundError:
            return []
        ep = base / ".anton" / "episodes"
        return [(name, ep)] if ep.is_dir() else []
    out: list[tuple[str, Path]] = []
    for proj in projects_store.list_projects():
        ep = Path(proj["path"]) / ".anton" / "episodes"
        if ep.is_dir():
            out.append((proj["name"], ep))
    return out


def list_conversations(limit: int = 200, project: Optional[str] = None) -> list[dict]:
    """Return conversation metadata, optionally scoped to a project name."""
    out: list[dict] = []
    for project_name, ep_dir in _candidate_episode_dirs(project):
        for path in ep_dir.iterdir():
            name = path.name
            if name.endswith("_meta.json"):
                cid = name.removesuffix("_meta.json")
            elif name.endswith("_history.json"):
                cid = name.removesuffix("_history.json")
            elif name.endswith(".jsonl") and not name.endswith("_meta.json") and not name.endswith("_history.json"):
                # Raw episode log — surface even when the manager
                # didn't get a chance to write meta/history (e.g. an
                # interrupted stream). Without this, the conversation
                # appears in older list snapshots but the server can
                # neither find nor delete it.
                cid = name.removesuffix(".jsonl")
            else:
                continue
            if any(c["id"] == cid for c in out):
                continue
            meta_path = ep_dir / f"{cid}_meta.json"
            meta: dict
            if meta_path.is_file():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    meta = {}
            else:
                meta = {}
            if not meta.get("id"):
                meta["id"] = cid
            if not meta.get("project"):
                meta["project"] = project_name
            # Backfill turns/preview from history if meta is sparse
            if not meta.get("turns") or not meta.get("preview"):
                hist_path = ep_dir / f"{cid}_history.json"
                if hist_path.is_file():
                    try:
                        history = json.loads(hist_path.read_text(encoding="utf-8"))
                        if isinstance(history, list):
                            meta["turns"] = sum(
                                1 for m in history if m.get("role") == "user"
                            )
                            for m in history:
                                if m.get("role") == "user":
                                    content = m.get("content", "")
                                    if isinstance(content, str):
                                        meta["preview"] = content.strip()[:60]
                                    break
                    except Exception:
                        pass
            out.append(meta)
    out.sort(
        key=lambda r: r.get("updated_at") or r.get("created_at") or "",
        reverse=True,
    )
    return out[:limit]


def _find_conversation_dir(conversation_id: str) -> tuple[str, Path] | None:
    """Return (project_name, episodes_dir) for a conversation id, if found.

    Conversations may exist as any combination of:
      <id>_meta.json      cowork-side metadata (title, project, etc.)
      <id>_history.json   chat history written by the manager
      <id>.jsonl          raw episode log written by the anton library
    Some flows (interrupted streams, legacy data) leave only the .jsonl
    behind, so we look for any of the three.
    """
    for project_name, ep_dir in _candidate_episode_dirs():
        if (ep_dir / f"{conversation_id}_meta.json").is_file():
            return project_name, ep_dir
        if (ep_dir / f"{conversation_id}_history.json").is_file():
            return project_name, ep_dir
        if (ep_dir / f"{conversation_id}.jsonl").is_file():
            return project_name, ep_dir
    return None


def get_conversation(conversation_id: str) -> dict | None:
    located = _find_conversation_dir(conversation_id)
    if not located:
        return None
    project_name, ep = located
    meta_path = ep / f"{conversation_id}_meta.json"
    if meta_path.is_file():
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            data["id"] = conversation_id
            if not data.get("project"):
                data["project"] = project_name
            return data
        except Exception:
            return None
    # Synthesize from history if meta missing
    hist_path = ep / f"{conversation_id}_history.json"
    if hist_path.is_file():
        try:
            history = json.loads(hist_path.read_text(encoding="utf-8"))
            if isinstance(history, list):
                turns = sum(1 for m in history if m.get("role") == "user")
                preview = ""
                for m in history:
                    if m.get("role") == "user":
                        content = m.get("content", "")
                        if isinstance(content, str):
                            preview = content.strip()[:60]
                        break
                return {
                    "id": conversation_id,
                    "title": preview[:50] or conversation_id,
                    "turns": turns,
                    "preview": preview,
                    "created_at": "",
                    "updated_at": "",
                    "project": project_name,
                }
        except Exception:
            return None
    return None


def get_messages(conversation_id: str) -> list[dict] | None:
    located = _find_conversation_dir(conversation_id)
    if not located:
        return None
    _, ep = located
    hist_path = ep / f"{conversation_id}_history.json"
    if not hist_path.is_file():
        return []
    try:
        data = json.loads(hist_path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def update_conversation(conversation_id: str, **patch) -> dict | None:
    located = _find_conversation_dir(conversation_id)
    if not located:
        return None
    project_name, ep = located
    meta_path = ep / f"{conversation_id}_meta.json"
    meta: dict
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    else:
        meta = {}
    allowed = {"title"}
    for k, v in patch.items():
        if k in allowed and v is not None:
            meta[k] = v
    meta["id"] = conversation_id
    if not meta.get("project"):
        meta["project"] = project_name
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        _atomic_write(meta_path, meta)
    except Exception:
        logger.debug("Could not update conversation meta", exc_info=True)
    return meta


def delete_conversation(conversation_id: str) -> bool:
    """Delete history + meta + raw episode log. Closes live session if any."""
    found = False
    located = _find_conversation_dir(conversation_id)
    if located:
        _, ep = located
        # _meta.json + _history.json are written by the manager; the
        # bare .jsonl is anton's raw episode log. All three need to go
        # so the conversation truly disappears.
        for suffix in ("_meta.json", "_history.json", ".jsonl"):
            p = ep / f"{conversation_id}{suffix}"
            if p.is_file():
                try:
                    p.unlink()
                    found = True
                except Exception:
                    pass
    _live.pop(conversation_id, None)
    return found


def move_conversation(conversation_id: str, target_project: str) -> dict | None:
    """Move a conversation's meta + history files to another project's
    episodes directory and update meta.project to match.

    The live session (if any) is closed because its in-memory state is
    bound to the old project's filesystem layout; it'll be re-created
    against the new project on the next chat turn.
    """
    located = _find_conversation_dir(conversation_id)
    if not located:
        return None
    src_project, src_ep = located
    if src_project == target_project:
        # Nothing to do — already in this project.
        return get_conversation(conversation_id)

    # Resolve target project dir; raise via projects_store if invalid.
    _, target_base = projects_store.resolve_project(target_project)
    target_ep = target_base / ".anton" / "episodes"
    target_ep.mkdir(parents=True, exist_ok=True)

    moved = False
    # Move all three file flavors so a moved conversation looks
    # identical to one created in the target project.
    for suffix in ("_meta.json", "_history.json", ".jsonl"):
        src = src_ep / f"{conversation_id}{suffix}"
        if not src.is_file():
            continue
        dst = target_ep / f"{conversation_id}{suffix}"
        try:
            src.replace(dst)
            moved = True
        except Exception:
            logger.debug("Could not move %s to %s", src, dst, exc_info=True)
    if not moved:
        return None

    # Rewrite meta to point at the new project.
    meta_path = target_ep / f"{conversation_id}_meta.json"
    meta: dict = {}
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    meta["id"] = conversation_id
    meta["project"] = target_project
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        _atomic_write(meta_path, meta)
    except Exception:
        logger.debug("Could not rewrite meta after move", exc_info=True)

    # Drop the in-memory session — it's bound to the old project path.
    _live.pop(conversation_id, None)
    return meta
