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


def _turns_path(project: Optional[str], conversation_id: str) -> Path:
    """Sidecar that holds the SSE event log per assistant turn.

    Schema:
        {
          "by_assistant_turn": {
            "0": {"started_at": <ms>, "events": [<sse-payload-dict>, ...]},
            "1": {...}
          }
        }

    The client runs its existing `responseStreamAdapter.reduceStream`
    over the events to derive the same `steps` array it builds during
    a live stream. Persisted server-side so reopening the conversation
    (or switching machines) restores the Thinking block, scratchpad
    cells, and inline artifact cards without any client-side state.
    """
    return _episodes_dir(project) / f"{conversation_id}_turns.json"


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


def _sanitize_history_for_anthropic(history: list[dict]) -> tuple[list[dict], int]:
    """Repair a conversation history so the Anthropic API accepts it
    on the next turn.

    Anthropic requires every assistant `tool_use` block to be followed
    by a user message containing a matching `tool_result` block. When
    a stream is stopped or errors mid-tool-use, anton may persist the
    `tool_use` without ever appending the result — and the next call
    fails with `400 invalid_request_error: tool_use ids were found
    without tool_result blocks immediately after`.

    This walks the history; for any assistant message with `tool_use`
    blocks whose ids aren't acknowledged in the next user message,
    we synthesize matching `tool_result` blocks marked as the call
    being interrupted by the user. We never delete tool_use entries
    (that'd lose context the model already committed to producing).

    Returns (fixed_history, repair_count). repair_count > 0 means the
    caller should write the result back to disk and drop the live
    session cache so the next turn loads the repaired form.
    """
    if not isinstance(history, list):
        return history, 0
    fixed: list[dict] = []
    repairs = 0
    i = 0
    n = len(history)
    while i < n:
        msg = history[i]
        fixed.append(msg)
        if not isinstance(msg, dict) or msg.get("role") != "assistant":
            i += 1
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            i += 1
            continue
        tool_use_ids = [
            b.get("id") for b in content
            if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id")
        ]
        if not tool_use_ids:
            i += 1
            continue

        # Look at the next message — if it's a user message with
        # tool_result blocks, gather the ids it acknowledges.
        next_msg = history[i + 1] if i + 1 < n else None
        next_content = (
            next_msg.get("content")
            if isinstance(next_msg, dict)
            else None
        )
        ack_ids: set = set()
        if isinstance(next_content, list):
            for b in next_content:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    tid = b.get("tool_use_id")
                    if tid:
                        ack_ids.add(tid)

        missing = [tid for tid in tool_use_ids if tid not in ack_ids]
        if not missing:
            i += 1
            continue

        repairs += len(missing)
        synth_blocks = [
            {
                "type": "tool_result",
                "tool_use_id": tid,
                "content": "[interrupted by user — tool call did not complete]",
                "is_error": True,
            }
            for tid in missing
        ]
        if (
            isinstance(next_msg, dict)
            and next_msg.get("role") == "user"
            and isinstance(next_content, list)
        ):
            # Merge synthetic results into the existing user message
            # so the conversation still flows cleanly.
            next_msg["content"] = synth_blocks + next_content
        else:
            # Insert a new user message right after the assistant turn
            # carrying the synthetic tool_result blocks.
            fixed.append({
                "role": "user",
                "content": synth_blocks,
            })
        i += 1
    return fixed, repairs


def _write_history(path: Path, history: list[dict]) -> bool:
    """Atomic-rename write for a history list. Returns True on success."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            os.replace(tmp, str(path))
            return True
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except Exception:
        logger.debug("Could not write history to %s", path, exc_info=True)
        return False


def repair_history_if_needed(project: Optional[str], conversation_id: str) -> int:
    """Sanitize history for a conversation across BOTH the cached
    in-memory session and the on-disk file. Returns the total number
    of tool_use ids that were patched (in-memory + disk).

    Why both: anton only flushes `_history.json` at the end of a
    successful turn (`_persist_history()` runs once at the tail of
    `turn_stream`). If a previous turn was stopped or errored
    mid-tool-use, the LIVE session's in-memory `_history` carries the
    unpaired `tool_use` while disk still reflects the previous good
    save. Anton sends `self._history` (the in-memory copy) to
    Anthropic on the next call, which is what triggers the
    `400 invalid_request_error: tool_use ids were found without
    tool_result blocks` we kept seeing.

    Strategy:
      1. Sanitize the on-disk history; write back if changed.
      2. If a session is cached, sanitize its in-memory `_history`
         in place. If repairs were needed, also push the patched
         version to disk via the session's HistoryStore so future
         loads stay clean.
      3. Drop the cached session if either path repaired anything,
         forcing a clean reload on the next call.
    """
    total = 0

    # Disk pass.
    history = _load_history(project, conversation_id)
    if isinstance(history, list):
        fixed, repairs = _sanitize_history_for_anthropic(history)
        if repairs:
            if _write_history(_history_path(project, conversation_id), fixed):
                total += repairs

    # In-memory pass — the source of truth anton actually sends.
    entry = _live.get(conversation_id)
    session = entry.get("session") if isinstance(entry, dict) else None
    if session is not None:
        live_hist = getattr(session, "_history", None)
        if isinstance(live_hist, list):
            fixed_live, live_repairs = _sanitize_history_for_anthropic(live_hist)
            if live_repairs:
                # Mutate the existing list in place so any other
                # reference anton holds (it's the single source) sees
                # the fix immediately.
                live_hist.clear()
                live_hist.extend(fixed_live)
                # Persist via the session's own store if available, so
                # future loads (including from another process) stay
                # consistent. Ignore failures — the in-memory fix is
                # what saves the very next turn.
                store = getattr(session, "_history_store", None)
                sid = getattr(session, "_session_id", None) or conversation_id
                if store is not None:
                    try: store.save(sid, live_hist)
                    except Exception: pass
                total += live_repairs

    if total > 0:
        # Drop the cache so the next `_resolve_session` rebuilds from
        # the now-clean disk history. Belt + suspenders alongside the
        # in-place mutation above.
        _live.pop(conversation_id, None)
        logger.info(
            "Repaired %d unpaired tool_use block(s) in %s before resuming",
            total, conversation_id,
        )
    return total


def _normalize_turns(payload: dict) -> tuple[dict, bool]:
    """Recover from sidecars written before record_turn_events used the
    displayable-assistant filter. Old sidecars may have entries keyed
    by raw history indices like '12' even when the displayable count
    was 1, leaving the read path unable to attach them.

    Detection: if max(index) >= entry count, the keys are sparse and
    we re-key sequentially in chronological order (by `started_at`,
    falling back to the original index). Otherwise the sidecar is
    already canonical and we leave it alone.

    Returns (normalized_payload, changed). `changed=True` means the
    caller should write the normalized version back to disk.
    """
    by_turn = payload.get("by_assistant_turn")
    if not isinstance(by_turn, dict) or not by_turn:
        return payload, False

    items: list[tuple[int, dict]] = []
    for k, v in by_turn.items():
        try:
            idx = int(k)
        except (ValueError, TypeError):
            continue
        if isinstance(v, dict):
            items.append((idx, v))
    if not items:
        return payload, False

    max_idx = max(i for i, _ in items)
    if max_idx < len(items):
        # Dense, already canonical (0..len-1).
        return payload, False

    # Sparse — sort by started_at (descending=False, so earliest first)
    # then renumber from 0. Ties or missing started_at fall back to the
    # original index so order is at least stable.
    items.sort(key=lambda kv: (
        kv[1].get("started_at")
        if isinstance(kv[1].get("started_at"), (int, float))
        else kv[0]
    ))
    new_by_turn = {str(new_idx): entry for new_idx, (_, entry) in enumerate(items)}
    return {**payload, "by_assistant_turn": new_by_turn}, True


def load_turns(conversation_id: str) -> dict | None:
    """Load the per-turn event sidecar for any conversation.

    Returns the parsed `{by_assistant_turn: {...}}` dict, or None if no
    sidecar exists yet (older conversations, or one that hasn't streamed
    a turn since this feature shipped). Lazily normalizes old sparse
    sidecars (from before `record_turn_events` filtered to displayable
    assistant turns) and writes the canonical version back so future
    reads are cheap.
    """
    located = _find_conversation_dir(conversation_id)
    if not located:
        return None
    _, ep = located
    path = ep / f"{conversation_id}_turns.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
    except Exception:
        return None

    normalized, changed = _normalize_turns(data)
    if changed:
        try:
            _atomic_write(path, normalized)
        except Exception:
            logger.debug("Could not rewrite normalized turns sidecar", exc_info=True)
    return normalized


def _displayable_text_for(msg: object) -> str | None:
    """Return the text the UI would render for this message, or None
    if it gets filtered out (mirroring `_parse_for_display`).
    """
    if not isinstance(msg, dict):
        return None
    role = msg.get("role")
    if role not in ("user", "assistant"):
        return None
    content = msg.get("content", "")
    if not content:
        return None
    if isinstance(content, list):
        text = "".join(
            (block.get("text") or "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
        return text if text else None
    return str(content) if str(content) else None


def _count_displayable_assistant_bubbles(history: list[dict]) -> int:
    """Count merged assistant bubbles in the displayable history —
    consecutive assistant text messages collapse into a single bubble
    (matches `_parse_for_display`'s merge behavior).

    Anton's session can emit multiple assistant text messages within a
    single user→answer cycle (e.g., a brief acknowledgement followed by
    the actual answer). The UI renders them as one bubble; the events
    sidecar is keyed off that bubble index, so we have to count the
    same way when persisting.
    """
    count = 0
    last_was_assistant = False
    for msg in history:
        text = _displayable_text_for(msg)
        if text is None:
            continue
        role = msg.get("role") if isinstance(msg, dict) else None
        if role == "assistant":
            if not last_was_assistant:
                count += 1
            last_was_assistant = True
        else:
            last_was_assistant = False
    return count


def record_turn_events(
    conversation_id: str,
    started_at_ms: int | None,
    events: list[dict],
) -> None:
    """Persist `events` for the most recently completed assistant turn.

    Called at the end of `/v1/responses` streams. Counts displayable
    assistant turns in the on-disk history (matching the filter
    `_parse_for_display` applies on read) so the persisted index is
    always the same one the client uses to look up `events` per
    message. Idempotent: re-recording an index overwrites it (so
    retries write the latest events). All failures are swallowed —
    the live stream must never block on this.
    """
    if not events:
        return
    located = _find_conversation_dir(conversation_id)
    if not located:
        return
    project, ep = located
    path = ep / f"{conversation_id}_turns.json"
    payload: dict
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            payload = loaded if isinstance(loaded, dict) else {}
        except Exception:
            payload = {}
    else:
        payload = {}
    by_turn = payload.get("by_assistant_turn")
    if not isinstance(by_turn, dict):
        by_turn = {}

    history = _load_history(project, conversation_id) or []
    displayable_count = _count_displayable_assistant_bubbles(history)
    # The stream just appended this turn's final assistant message,
    # so `displayable_count - 1` is its 0-based bubble index in the
    # merged display. Fall back to the next free slot if history is
    # empty for some reason (partial save) — better to capture
    # out-of-order than lose the events.
    if displayable_count > 0:
        turn_idx = displayable_count - 1
    else:
        turn_idx = len(by_turn)

    by_turn[str(turn_idx)] = {
        "started_at": started_at_ms,
        "events": events,
    }
    payload["by_assistant_turn"] = by_turn
    try:
        _atomic_write(path, payload)
    except Exception:
        logger.debug("Could not persist turn events for %s", conversation_id, exc_info=True)


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


def _seed_meta_from_user_input(
    project: Optional[str],
    conversation_id: str,
    user_input: object,
) -> None:
    """Populate `title` + `preview` from the first user message of a
    fresh conversation so the recents listing reflects the
    conversation immediately, not just after the turn completes.

    Idempotent: bails if the conversation already has a non-empty
    title, so subsequent turns don't relabel a renamed conversation.
    """
    if not user_input:
        return
    text = user_input if isinstance(user_input, str) else str(user_input)
    text = text.strip()
    if not text:
        return
    meta = _load_meta(project, conversation_id) or {}
    if meta.get("title"):
        return
    preview = text[:60]
    now = datetime.now(timezone.utc).isoformat()
    meta["id"] = conversation_id
    meta["title"] = preview[:50] + ("..." if len(preview) > 50 else "")
    meta["preview"] = preview
    if not meta.get("project"):
        try:
            meta["project"], _ = projects_store.resolve_project(project)
        except FileNotFoundError:
            pass
    if not meta.get("created_at"):
        meta["created_at"] = now
    meta["updated_at"] = now
    _save_meta(project, conversation_id, meta)


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
    from anton.tools import CONNECT_DATASOURCE_TOOL
    from anton.workspace import Workspace
    # Cowork override — anton's stock PUBLISH_TOOL prints to a Rich
    # Console and pops a webbrowser, both of which die in the FastAPI
    # process. The wrapper exposes the same schema to the LLM but
    # routes through a server-aware handler.
    from .cowork_tools import build_cowork_publish_tool
    PUBLISH_TOOL = build_cowork_publish_tool()

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

    # Seed the conversation's title + preview from the user's first
    # message immediately, so the recents listing shows the right
    # name even while the stream is in flight. Anton only flushes
    # `_persist_history()` at the tail of a successful turn — so
    # without this, navigating away mid-stream and coming back finds
    # the conversation labelled with its raw id.
    try:
        _seed_meta_from_user_input(project, cid, user_input)
    except Exception:
        logger.debug("Could not seed meta from user input", exc_info=True)

    # If a previous turn was stopped or errored mid-tool-use, the
    # history may contain an assistant `tool_use` block without a
    # matching user `tool_result`. The Anthropic API rejects that
    # ("400 invalid_request_error: tool_use ids were found without
    # tool_result blocks"). Patch any such gaps before we hand the
    # conversation to anton's session — and drop the cached session
    # so the repaired history is what the LLM sees.
    try:
        repair_history_if_needed(project, cid)
    except Exception:
        logger.debug("History repair pass failed", exc_info=True)

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


def _is_user_input_message(msg: object) -> bool:
    """True iff this is a real user-typed message (vs a tool_result
    user message that anton inserts mid-turn). User input messages
    are the boundaries between displayable turns.
    """
    if not isinstance(msg, dict):
        return False
    if msg.get("role") != "user":
        return False
    content = msg.get("content")
    if isinstance(content, str):
        return bool(content)
    if isinstance(content, list):
        return any(
            isinstance(b, dict) and b.get("type") == "text" and b.get("text")
            for b in content
        )
    return False


def delete_turn(conversation_id: str, turn_index: int) -> dict | None:
    """Remove one user→answer cycle (the user's question + all
    assistant messages anton produced in response, including any
    intermediate tool_use / tool_result blocks) from a conversation.

    `turn_index` is the 0-based displayable bubble index — the same
    index `record_turn_events` keys the events sidecar by, and the
    same index `_parse_for_display` exposes to the client. So when
    the user clicks the trash on the Nth assistant bubble, we delete
    the slice from the Nth user-input message through to (but not
    including) the (N+1)th user-input message.

    Side effects: rewrites `_history.json`, drops the matching entry
    from `_turns.json` and reindexes higher entries down by one,
    drops the live in-memory session so anton rebuilds against the
    truncated history. Returns a summary dict, or None if the
    conversation can't be located.
    """
    located = _find_conversation_dir(conversation_id)
    if not located:
        return None
    project, ep = located
    history = _load_history(project, conversation_id)
    if not isinstance(history, list) or not history:
        return None

    # Find every user-input boundary in the raw history.
    user_input_indices = [
        i for i, m in enumerate(history) if _is_user_input_message(m)
    ]
    if turn_index < 0 or turn_index >= len(user_input_indices):
        return None

    start = user_input_indices[turn_index]
    end = (
        user_input_indices[turn_index + 1]
        if turn_index + 1 < len(user_input_indices)
        else len(history)
    )

    new_history = history[:start] + history[end:]
    if not _write_history(_history_path(project, conversation_id), new_history):
        return None

    # Reindex the events sidecar — drop the matching entry, shift any
    # higher indices down by one. Skip silently if the sidecar's
    # missing or unreadable.
    turns_path = ep / f"{conversation_id}_turns.json"
    if turns_path.is_file():
        try:
            payload = json.loads(turns_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                by_turn = payload.get("by_assistant_turn") or {}
                if isinstance(by_turn, dict):
                    new_by_turn: dict = {}
                    for k, v in by_turn.items():
                        try:
                            idx = int(k)
                        except (ValueError, TypeError):
                            continue
                        if idx == turn_index:
                            continue
                        if idx > turn_index:
                            idx -= 1
                        new_by_turn[str(idx)] = v
                    payload["by_assistant_turn"] = new_by_turn
                    try:
                        _atomic_write(turns_path, payload)
                    except Exception:
                        logger.debug(
                            "Could not rewrite turns sidecar after delete",
                            exc_info=True,
                        )
        except Exception:
            logger.debug("Could not parse turns sidecar", exc_info=True)

    # Drop the live session so anton rebuilds with the truncated
    # history on the next chat call.
    _live.pop(conversation_id, None)

    return {
        "conversation_id": conversation_id,
        "turn_index": turn_index,
        "removed_count": end - start,
        "remaining_messages": len(new_history),
    }


def delete_conversation(conversation_id: str) -> bool:
    """Delete history + meta + raw episode log. Closes live session if any."""
    found = False
    located = _find_conversation_dir(conversation_id)
    if located:
        _, ep = located
        # _meta.json + _history.json are written by the manager; the
        # bare .jsonl is anton's raw episode log; _turns.json is the
        # cowork-side per-turn event sidecar. All four need to go so
        # the conversation truly disappears.
        for suffix in ("_meta.json", "_history.json", "_turns.json", ".jsonl"):
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
    # Move all file flavors so a moved conversation looks identical to
    # one created in the target project — meta + history + turn events
    # sidecar + raw episode log.
    for suffix in ("_meta.json", "_history.json", "_turns.json", ".jsonl"):
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


def relabel_project(new_name: str) -> int:
    """Rewrite every conversation's `_meta.json` under `new_name` so
    its `project` field matches the project's current name on disk.

    Called after `projects_store.rename_project` completes the
    directory rename. Without this, every conversation that lived
    under the old project keeps its stale `project: <old_name>` in
    meta, which the listing route preserves as-is — so the UI shows
    those tasks under a phantom project that no longer exists.

    Also drops any live in-memory sessions whose project matches the
    renamed one, so the next chat turn rebuilds the session against
    the new on-disk path.

    Returns the number of meta files that were updated.
    """
    if not new_name:
        return 0
    ep_dir = _episodes_dir(new_name)
    if not ep_dir.is_dir():
        return 0

    rewrote = 0
    for path in sorted(ep_dir.glob("*_meta.json")):
        try:
            meta = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(meta, dict):
            continue
        current = meta.get("project")
        if current == new_name:
            continue
        meta["project"] = new_name
        meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            _atomic_write(path, meta)
            rewrote += 1
        except Exception:
            logger.debug("Could not relabel %s", path, exc_info=True)

    # Drop any live sessions associated with this renamed project so
    # the next turn rebuilds them. We don't track project on the cache
    # entry uniformly; safest is to drop everything whose cached
    # project matches the new name (after rename, the live entry's
    # project string is the *old* name — but we keyed cleanup off the
    # path inside chat_session anyway). Cheap insurance: blow the
    # whole cache; sessions are reconstituted on next turn from disk.
    if _live:
        # Only clear sessions that touch this project — but since we
        # only stored `{session, project}` and the rename already
        # updated projects_store, the simplest correct thing is to
        # close any sessions whose stored project string changed.
        for cid, entry in list(_live.items()):
            if entry.get("project") == new_name:
                continue
            # Heuristic: close everything; ChatSessions are cheap to
            # rebuild and we want zero stale path bindings.
            _live.pop(cid, None)

    return rewrote
