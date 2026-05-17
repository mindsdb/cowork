"""Conversation lifecycle manager.

Owns:
  - The in-memory pool of live ChatSession instances (capped, evicted oldest).
  - The "build a ChatSession for this project" recipe that cowork was
    using inside anton_bridge._build_chat_session.
  - On-disk history persistence (delegated to anton.memory.HistoryStore).
  - Conversation metadata (id / title / turns / preview / created_at /
    updated_at / project, disabled_connections) persisted alongside history.

The public API is small:
  - chat_stream(input, conversation_id, project, model, disabled_connections=None) → (stream, id)
  - list_conversations(limit, project)
  - get_conversation(id)
  - get_messages(id)
  - update_conversation(id, **patch)  # title, disabled_connections
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

import asyncio
import dataclasses
import json
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, AsyncIterator, Optional

from anton_api import stream_registry as _stream_registry
from anton_api.turn_buffer import (
    BufferedTurnWriter,
    TurnRecord,
    tail_buffer,
    turn_buffer_path,
)


_TITLE_MAX_LEN = 160
_TITLE_WHITESPACE_RE = re.compile(r"\s+")


def sanitize_title(value: object) -> str | None:
    """Normalize a user-provided conversation title.

    - Strips outer whitespace.
    - Collapses internal whitespace runs (newlines, tabs, repeats) to
      a single space, so a pasted multi-line block doesn't blow up the
      sidebar row height.
    - Caps at 160 chars (the UI typically truncates well before this).
    Returns `None` if the result is empty so callers can preserve the
    existing title rather than blanking it.
    """
    if not isinstance(value, str):
        return None
    cleaned = _TITLE_WHITESPACE_RE.sub(" ", value).strip()
    if not cleaned:
        return None
    return cleaned[:_TITLE_MAX_LEN].strip()

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
    """Resolve project name → filesystem path. None ⇒ active project.

    Fallback: if `project` is named but its directory is missing
    (e.g. the user deleted the project on disk while a stale
    conversation is still cached on the client with that
    `projectName`), silently fall back to the active project. That
    project itself self-heals to "default" via `get_active` if its
    own dir is gone, so a chat can always make forward progress.
    Without this, every downstream file open under the deleted dir
    surfaces as "[Errno 2] No such file or directory" and the user
    can't chat anywhere until they fix it manually.
    """
    try:
        _, base = projects_store.resolve_project(project)
        return base
    except FileNotFoundError:
        if project:
            logger.info(
                "Project '%s' no longer exists on disk; falling back to active project.",
                project,
            )
        _, base = projects_store.resolve_project(None)
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


def _connection_pair_key(engine: str, name: str) -> tuple[str, str]:
    return (engine.strip().lower(), name.strip())


def normalize_disabled_connections(raw: object) -> list[dict[str, str]]:
    """Return a deduped list of ``{engine, name}`` dicts for vault scoping."""
    if raw is None or not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        eng = item.get("engine")
        nm = item.get("name")
        if not isinstance(eng, str) or not isinstance(nm, str):
            continue
        eng, nm = eng.strip(), nm.strip()
        if not eng or not nm:
            continue
        key = _connection_pair_key(eng, nm)
        if key in seen:
            continue
        seen.add(key)
        out.append({"engine": eng, "name": nm})
    return out


def load_disabled_connections(project: Optional[str], conversation_id: str) -> list[dict[str, str]]:
    meta = _load_meta(project, conversation_id)
    if not meta:
        return []
    return normalize_disabled_connections(meta.get("disabled_connections"))


def load_disabled_connections_for_conversation(conversation_id: str) -> list[dict[str, str]]:
    """Load the denylist using the project directory where this id's episodes live."""
    located = _find_conversation_dir(conversation_id)
    if not located:
        return []
    project_name, _ = located
    return load_disabled_connections(project_name, conversation_id)


def conversation_datasource_scope_for_id(conversation_id: str) -> dict[str, Any]:
    """All vault connections plus which are muted for this conversation (for tools / API)."""
    disabled = load_disabled_connections_for_conversation(conversation_id)
    dset = {_connection_pair_key(d["engine"], d["name"]) for d in disabled}
    connections: list[dict[str, Any]] = []
    vault_available = False
    try:
        from anton.core.datasources.data_vault import LocalDataVault
    except Exception:
        return {
            "conversation_id": conversation_id,
            "disabled_connections": disabled,
            "connections": [],
            "vault_available": False,
        }
    vault = LocalDataVault()
    vault_available = True
    try:
        for conn in vault.list_connections():
            eng = conn.get("engine")
            nm = conn.get("name")
            if not eng or not nm:
                continue
            key = _connection_pair_key(str(eng), str(nm))
            connections.append({
                "engine": eng,
                "name": nm,
                "disabled": key in dset,
            })
    except Exception:
        logger.debug("conversation_datasource_scope: list_connections failed", exc_info=True)
    return {
        "conversation_id": conversation_id,
        "disabled_connections": disabled,
        "connections": connections,
        "vault_available": vault_available,
    }


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

    Anthropic enforces TWO matching constraints on tool calls:
      (1) every assistant `tool_use` must be followed by a user
          message containing a `tool_result` with the same id, AND
      (2) every user `tool_result` must be preceded by an assistant
          message whose `tool_use` carries the matching id.

    Both invariants can break. Anton's auto-retry path on stream
    failure appends a "SYSTEM: error" user message right after a
    dangling `tool_use` — violating (1). Anton's history truncation
    can drop the assistant turn that owned a `tool_use` while
    keeping the user turn that carried its `tool_result` — violating
    (2). Either failure surfaces as a 400.

    The sanitizer applies two passes:
      • Pass 1 — scan assistant messages with `tool_use` blocks.
        For any id NOT acknowledged in the next user message, splice
        a synthetic `tool_result` block ("interrupted by user — tool
        call did not complete") into the next user message (or
        insert a new user message right after).
      • Pass 2 — scan user messages with `tool_result` blocks. For
        each block whose `tool_use_id` doesn't match a `tool_use` in
        the *immediately preceding* assistant message, drop that
        block. If a user message ends up with no surviving content,
        drop the message entirely.

    Pass 1 fixes the "tool_use without tool_result" 400.
    Pass 2 fixes the "tool_result without tool_use" 400.

    Returns (fixed_history, repair_count). repair_count > 0 means
    the caller should write the result back to disk and drop the
    live session cache so the next turn loads the repaired form.
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

    # ── Pass 2 — strip orphan tool_result blocks ───────────────────
    #
    # A `tool_result` block whose `tool_use_id` doesn't match a
    # `tool_use` in the IMMEDIATELY PRECEDING assistant message
    # produces:
    #   400 invalid_request_error: unexpected `tool_use_id` found
    #   in `tool_result` blocks: <id>. Each `tool_result` block
    #   must have a corresponding `tool_use` block in the previous
    #   message.
    # Most often: a previous truncation pass dropped the assistant
    # turn that owned the tool_use but left the user turn with the
    # tool_result intact. We drop the orphan block. If a user message
    # consisted ONLY of orphan tool_results, it gets removed entirely
    # — leaving such a message in place would either consecutive-user
    # or empty-content the API.
    cleaned: list[dict] = []
    for idx, msg in enumerate(fixed):
        if not (isinstance(msg, dict) and msg.get("role") == "user"):
            cleaned.append(msg)
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            cleaned.append(msg)
            continue
        # Find the immediately-preceding assistant message in the
        # CLEANED list (not `fixed`) so we follow whatever pass 1 did.
        prev_assistant = None
        for back in reversed(cleaned):
            if not isinstance(back, dict):
                continue
            if back.get("role") == "assistant":
                prev_assistant = back
                break
            if back.get("role") == "user":
                # Hit another user before any assistant — no possible
                # tool_use in scope.
                break
        prev_tool_use_ids: set = set()
        if isinstance(prev_assistant, dict):
            pc = prev_assistant.get("content")
            if isinstance(pc, list):
                prev_tool_use_ids = {
                    b.get("id") for b in pc
                    if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id")
                }
        survived: list = []
        dropped_orphans = 0
        for b in content:
            if (
                isinstance(b, dict)
                and b.get("type") == "tool_result"
                and b.get("tool_use_id")
                and b.get("tool_use_id") not in prev_tool_use_ids
            ):
                dropped_orphans += 1
                continue
            survived.append(b)
        if dropped_orphans:
            repairs += dropped_orphans
            if not survived:
                # Drop the now-empty user message entirely.
                continue
            cleaned.append({**msg, "content": survived})
        else:
            cleaned.append(msg)

    return cleaned, repairs


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

    Must apply the SAME filters as the display layer — empty
    content, SYSTEM: auto-retry prompts, non-user/assistant roles.
    Otherwise `_count_displayable_assistant_bubbles` (which drives
    the per-turn sidecar key) reads a different bubble count than
    the renderer renders, and event metadata lands under the wrong
    index after a reload.
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
        if not text:
            return None
    else:
        text = str(content)
        if not text:
            return None
    # Filter anton-core's auto-retry / failure-recovery prompts the
    # same way `_parse_for_display` does. Keeps the bubble count in
    # lockstep with what the renderer actually shows.
    if role == "user" and text.lstrip().startswith("SYSTEM:"):
        return None
    return text


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
    # Same fallback as `_project_base`: if the named project is gone,
    # resolve to the active one so the new meta lands somewhere valid
    # and the chat can continue.
    try:
        name, _ = projects_store.resolve_project(project)
    except FileNotFoundError:
        name, _ = projects_store.resolve_project(None)
    meta = {
        "id": conversation_id,
        "title": "",
        "turns": 0,
        "preview": "",
        "created_at": now,
        "updated_at": now,
        "project": name,
        "disabled_connections": [],
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
# Artifact reconciliation — pre/post-turn snapshot/diff so every turn
# that touches an artifact folder gets stamped into its provenance.
#
# The snapshot is `{relative_path: (mtime_ns, size)}`; the diff
# walks the after-snapshot and flags every entry that's new or
# differs from the before-snapshot. Groups changed files by top-
# level slug (the artifact folder name) and writes one provenance
# entry per touched artifact.
# ---------------------------------------------------------------------------


# Files that are housekeeping, not user-content. The store writes
# both on every save, so they'd otherwise show up in every diff
# and pollute provenance.
_ARTIFACT_HOUSEKEEPING = {"metadata.json", "README.md"}


def _reconcile_artifacts_after_turn(
    *,
    artifacts_root: Path,
    conversation_id: str,
    project: Optional[str],
    user_input: str,
    turn_index: int,
    snapshot_before: dict,
) -> None:
    """For each artifact folder modified during the turn, append a
    provenance entry + rescan its file list.

    No-op when the artifacts dir doesn't exist or no files changed.
    Failures are logged at WARNING and swallowed — provenance is a
    nice-to-have, not load-bearing for the conversation flow.
    """
    try:
        from anton.core.artifacts import (
            ArtifactStore,
            diff_snapshots,
            snapshot_dir,
        )
        from anton.core.artifacts.snapshot import _files_by_artifact
    except Exception:
        logger.debug("Anton artifact module unavailable; skipping reconcile", exc_info=True)
        return
    if not artifacts_root.exists():
        return
    after = snapshot_dir(artifacts_root)
    changed = diff_snapshots(snapshot_before, after)
    if not changed:
        return
    grouped = _files_by_artifact(changed)
    if not grouped:
        return
    meta = _load_meta(project, conversation_id) or {}
    title = meta.get("title") or None
    store = ArtifactStore(artifacts_root)
    summary = (user_input or "").strip()
    for slug, files in grouped.items():
        # Housekeeping files (metadata.json, README.md) get rewritten on
        # every store save — drop them from the touched set so they
        # don't pollute provenance with no-op turns.
        user_files = sorted(f for f in files if f not in _ARTIFACT_HOUSEKEEPING)
        if not user_files:
            continue
        try:
            store.record_turn(
                slug,
                conversation_id=conversation_id,
                conversation_title=title,
                turn_index=turn_index,
                summary=summary,
                files_touched=user_files,
            )
            store.rescan_files(slug)
        except Exception:
            logger.warning(
                "Failed to record artifact provenance for %s (slug=%s)",
                conversation_id, slug, exc_info=True,
            )


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
    from .cowork_tools import (
        build_cowork_publish_tool,
        build_cowork_request_credentials_tool,
        build_cowork_fetch_submission_tool,
        build_cowork_update_form_tool,
        build_cowork_lookup_connector_tool,
        build_list_conversation_datasources_tool,
    )
    PUBLISH_TOOL = build_cowork_publish_tool()
    REQUEST_CREDENTIALS_TOOL = build_cowork_request_credentials_tool()
    FETCH_SUBMISSION_TOOL = build_cowork_fetch_submission_tool()
    UPDATE_FORM_TOOL = build_cowork_update_form_tool()
    LOOKUP_CONNECTOR_TOOL = build_cowork_lookup_connector_tool()
    LIST_CONVERSATION_DATASOURCES_TOOL = build_list_conversation_datasources_tool()

    try:
        from anton.core.datasources.data_vault import LocalDataVault
    except Exception:  # pragma: no cover
        LocalDataVault = None

    base = _project_base(project)
    # Reload ~/.anton/.env into os.environ before building settings.
    # AntonSettings caches its env_file list at module import time — if the
    # server started before ~/.anton/.env existed (first-run onboarding),
    # the file is not in the cached list and planning_provider would fall
    # back to the "anthropic" default, causing a TypeError when no
    # ANTHROPIC_API_KEY is set. Loading the file here ensures settings
    # always reflect the current config, even after onboarding.
    # Skip server-operational vars that the Electron host controls.
    _SERVER_MANAGED_KEYS = {"ANTON_SERVER_PORT", "ANTON_SERVER_HOST", "ANTON_PROJECTS_DIR"}
    _user_env = Path.home() / ".anton" / ".env"
    if _user_env.is_file():
        for _line in _user_env.read_text(encoding="utf-8").splitlines():
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                _k = _k.strip()
                if _k not in _SERVER_MANAGED_KEYS:
                    os.environ[_k] = _v.strip().strip('"').strip("'")
    settings = AntonSettings()
    settings.resolve_workspace(str(base))
    if model:
        # Minds Cloud sentinels (`_reason_`, `_code_`) only resolve at
        # the openai-compatible router. If the active provider is
        # something else (e.g. anthropic, after the user switched off
        # Minds), an old cowork preference can keep sending these on
        # every request. Drop the override and stay with the env's
        # `ANTON_PLANNING_MODEL` instead of forwarding `_reason_` to
        # api.anthropic.com (which 404s).
        is_minds_sentinel = model.startswith("_") and model.endswith("_")
        if is_minds_sentinel and settings.planning_provider != "openai-compatible":
            logging.getLogger(__name__).warning(
                "Ignoring Minds sentinel model %r — active planning_provider is %r. "
                "Falling back to env ANTON_PLANNING_MODEL=%r.",
                model, settings.planning_provider, settings.planning_model,
            )
        else:
            settings.planning_model = model

    workspace = Workspace(base)
    workspace.initialize()
    workspace.apply_env_to_process()

    anton_dir = base / ".anton"
    def _settings_path(value: object, fallback: Path) -> Path:
        raw = str(value or "").strip()
        if not raw:
            return fallback
        path = Path(raw).expanduser()
        return path if path.is_absolute() else base / path

    artifacts_dir = anton_dir / "artifacts"
    context_dir = _settings_path(getattr(settings, "context_dir", None), anton_dir / "context")
    episodes_dir = anton_dir / "episodes"
    project_memory_dir = anton_dir / "memory"
    for directory in (artifacts_dir, context_dir, episodes_dir, project_memory_dir):
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

    project_context = (
        f"You are operating in the project {project}."
        f"You have access to all of the files in the project at {str(base)} except for the .anton/ directory."
        "They are off limits. Do not mention the .anton/ directory in your responses."
        "You can perform operations on these files via the scratchpad."
        "You can freely read any of these project files."
        "If you need to perform any actions on these files, ask the user for permission first."
        "The only other files that you are allowed to access are any items that are attached to the conversation."
        "Access to any files not attached to the conversation or located outside the project is strictly forbidden."
        "ALWAYS use the scratchpad to interact with files."
        f"Your scratchpad's working directory is {str(base)} — bare relative paths like `open('data.csv')` resolve from the project root."
    )
    output_context = (
        # Artifacts now live in their own visible folder at the
        # project root (`<base>/artifacts/<slug>/...`), one folder
        # per output. The agent never picks the folder name itself
        # — it calls `create_artifact` to claim one, then writes
        # files into the absolute path the tool returns. Provenance
        # (which conversation, which turns) is tracked server-side
        # and stamped into each folder's metadata.json + README.md
        # automatically.
        f"User-facing artifacts (HTML dashboards, CSVs, PDFs, datasets, fullstack apps, etc.) live under `{str(artifacts_dir)}/`. "
        "Workflow:\n"
        "  1. Call `create_artifact(name, description, type)` BEFORE writing any output. "
        "It returns `{slug, path, ...}` — write your files into the returned `path`.\n"
        "  2. To MODIFY an existing artifact, call `list_artifacts()` to find its slug, "
        "then `open_artifact(slug)` to get the path again.\n"
        "  3. Use absolute paths from a scratchpad cell so the file always lands in the right place: "
        "`with open(f\"{path}/dashboard.html\", \"w\") as f: ...`\n"
        "Never write to the legacy `.anton/output/` directory — it's no longer scanned by the artifacts view."
    )

    data_vault = LocalDataVault() if LocalDataVault is not None else None
    google_drive_oauth_connected = False
    disabled = load_disabled_connections(project, conversation_id)
    disabled_keys = {_connection_pair_key(d["engine"], d["name"]) for d in disabled}
    if data_vault is not None:
        try:
            for conn in data_vault.list_connections():
                engine = conn.get("engine")
                name = conn.get("name")
                if engine and name:
                    if _connection_pair_key(str(engine), str(name)) in disabled_keys:
                        continue
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

    datasource_scope_guidance = (
        " SAVED DATASOURCES: Before you run queries, connection tests, `connect_datasource`, "
        "scratchpad probes, or any step that assumes a specific saved vault connection is in play, "
        "call `list_conversation_datasources` with `{}` and treat its JSON as authoritative: "
        "each connection includes `disabled` when the user muted it for this conversation "
        "(those credentials are not injected for this chat). Re-call the tool later in the "
        "thread if the user may have changed muting. Do not infer availability only from "
        "environment variables."
        "This tool should be called before any action taken on connectors, even if the conversation "
        "history implies that you previously had access to the connector. This is because the user may "
        "have muted the connector since the last time you called this tool."
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
                f"{project_context}"
                f"{integration_guidance}"
                f"{datasource_scope_guidance}"
            ),
            output_context=output_context,
        ),
        workspace=workspace,
        data_vault=data_vault,
        initial_history=initial_history,
        history_store=history_store,
        session_id=conversation_id,
        proactive_dashboards=settings.proactive_dashboards,
        tools=[
            CONNECT_DATASOURCE_TOOL,
            PUBLISH_TOOL,
            LOOKUP_CONNECTOR_TOOL,
            REQUEST_CREDENTIALS_TOOL,
            FETCH_SUBMISSION_TOOL,
            UPDATE_FORM_TOOL,
            LIST_CONVERSATION_DATASOURCES_TOOL,
        ],
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


def _evict_session(conversation_id: str) -> None:
    """Drop a single cached session. Used when staleness is detected
    so the next turn rebuilds against current paths / settings."""
    _live.pop(conversation_id, None)


def _session_base_is_stale(entry: dict) -> bool:
    """Return True when the cached session was built against a base
    directory that no longer exists or now resolves elsewhere.

    Common trigger: the user deletes a project on disk while a stale
    conversation in that project is still cached. The session captured
    `output_dir` / `context_dir` / `episodes_dir` paths under the now-
    missing project dir; every subsequent turn raises ENOENT trying
    to write history / append context. The user-visible symptom is
    `[Errno 2] No such file or directory`, and a server restart fixes
    it because the cache is gone after restart.

    We compare the snapshotted project base path against what the
    project name resolves to NOW. Mismatch (or the snapshotted dir
    disappearing) means rebuild."""
    snapped_base = entry.get("base")
    if not snapped_base:
        # Older cache entries without a base recorded — treat as
        # fresh; the upcoming turn will either succeed or trip
        # the runtime FileNotFoundError handler.
        return False
    try:
        # _project_base never raises — it falls back to active project
        # if the named one is missing. So if the snapshotted base no
        # longer exists OR _project_base would now resolve elsewhere,
        # we know the cache is pointing at a stale directory.
        current = _project_base(entry.get("project"))
    except Exception:
        return True
    snapped_path = Path(snapped_base)
    if not snapped_path.exists():
        return True
    if Path(current).resolve() != snapped_path.resolve():
        return True
    return False


async def _resolve_session(
    conversation_id: str,
    project: Optional[str],
    model: Optional[str],
):
    entry = _live.get(conversation_id)
    if entry is not None:
        if _session_base_is_stale(entry):
            logger.info(
                "Conversation %s session was built against a stale base path; "
                "rebuilding so the new turn doesn't ENOENT.",
                conversation_id,
            )
            _evict_session(conversation_id)
        else:
            return entry["session"]

    if len(_live) >= MAX_CONVERSATIONS:
        _evict_oldest()

    base = _project_base(project)
    session = await _build_chat_session(conversation_id, project, model)
    _live[conversation_id] = {"session": session, "project": project, "base": str(base)}
    return session


# ---------------------------------------------------------------------------
# Stream event serialization (Phase 1 — file-backed turn buffer)
# ---------------------------------------------------------------------------


def _serialize_event(event: Any) -> dict:
    """Convert an anton-core stream event into a JSON-safe dict.

    Anton-core's stream events are small dataclasses defined in
    ``anton.core.llm.provider`` (``StreamTextDelta``,
    ``StreamTaskProgress``, ``StreamToolResult``,
    ``StreamContextCompacted``, ``StreamComplete``, etc.). They're
    pure data — no methods, no references — so ``asdict`` plus a
    best-effort repr fallback covers every shape we've seen.

    The producer side (``_produce_turn``) calls this on every event
    before writing to the buffer. The reader side
    (``_reconstruct_event``) does the inverse on each replayed
    record.
    """
    if dataclasses.is_dataclass(event) and not isinstance(event, type):
        try:
            return dataclasses.asdict(event)
        except Exception:
            pass
    # Defensive fallback — never raise here, the producer can't
    # afford to lose an event over a serialization quirk. ``_repr``
    # is enough to debug without breaking the JSONL shape.
    return {"_repr": repr(event)[:500]}


_RECONSTRUCT_CACHE: dict[str, Any] = {}


def _reconstruct_event(rec: TurnRecord) -> Any:
    """Rebuild an anton-core event from a buffered ``TurnRecord``.

    Returns ``None`` for records the route doesn't care about
    (terminal markers — the reader handles those out-of-band). For
    real events, looks up the dataclass in
    ``anton.core.llm.provider`` by record type name and instantiates
    it. If reconstruction fails (a future event type, schema drift),
    we surface the raw dict back to the caller as a fallback so
    nothing silently disappears.
    """
    if rec.type in ("Done", "Cancelled", "Error", "Interrupted"):
        return None  # terminal — the reader handles these explicitly

    cls = _RECONSTRUCT_CACHE.get(rec.type)
    if cls is None and rec.type not in _RECONSTRUCT_CACHE:
        # First sighting of this type — try to resolve it. Cache the
        # answer (including the None / "not found" case) so a stream
        # of identical event types doesn't hit the import machinery.
        try:
            import anton.core.llm.provider as _provider
            candidate = getattr(_provider, rec.type, None)
            if candidate is not None and dataclasses.is_dataclass(candidate):
                cls = candidate
        except Exception:
            cls = None
        _RECONSTRUCT_CACHE[rec.type] = cls

    if cls is None:
        # Unknown / non-dataclass type — return the raw dict shape.
        # The route's formatter is tolerant of dict-shaped events.
        return rec.data
    try:
        return cls(**rec.data)
    except Exception:
        logger.debug(
            "Could not reconstruct %s from buffered record (data=%r)",
            rec.type, rec.data,
            exc_info=True,
        )
        return rec.data


# ---------------------------------------------------------------------------
# Producer — runs anton-core's turn_stream into a buffer (detached task)
# ---------------------------------------------------------------------------


def _is_tool_use_error(exc: Exception) -> bool:
    """Detect Anthropic's tool-pairing 400s — same shape the old
    ``_stream()`` inline helper recognized. Hoisted to module level so
    ``_produce_turn`` can call it without a closure.
    """
    s = str(exc)
    if "tool_use" not in s and "tool_use_id" not in s and "tool_result" not in s:
        return False
    return (
        "tool_result" in s
        or "without `tool_result`" in s
        or "ids were found" in s
        or "unexpected `tool_use_id`" in s
        or "unexpected tool_use_id" in s
        or "corresponding `tool_use`" in s
        or "corresponding tool_use" in s
    )


async def _finalize_history_on_explicit_cancel(
    session: Any,
    partial_assistant_parts: list[str],
) -> None:
    """When the producer is explicitly cancelled (Phase 3 ``/cancel``
    endpoint), persist whatever partial state we had so the next time
    this conversation loads, the user sees the truncated answer rather
    than a stranded user message.

    NOT called on consumer disconnect — that's the whole point of the
    rewrite. The producer keeps going regardless of who's listening;
    only an explicit cancel path triggers this finalize.
    """
    try:
        hist = session.history or []
        last = hist[-1] if hist else None
        last_role = last.get("role") if isinstance(last, dict) else None
        needs_finalize = False
        if last_role == "user":
            needs_finalize = True
        elif last_role == "assistant" and isinstance(last.get("content"), list):
            if any(
                isinstance(b, dict) and b.get("type") == "tool_use"
                for b in last.get("content") or []
            ):
                needs_finalize = True
        if not needs_finalize:
            return

        try:
            session._seal_dangling_tool_uses("stopped by user")
        except Exception:
            logger.debug("Seal dangling tool_uses failed on cancel", exc_info=True)

        hist = session.history or []
        last = hist[-1] if hist else None
        last_role = last.get("role") if isinstance(last, dict) else None
        if last_role == "user":
            partial_text = "".join(partial_assistant_parts).strip()
            placeholder = (
                f"{partial_text}\n\n_[Stopped by user]_"
                if partial_text
                else "_[Stopped by user before a response was produced.]_"
            )
            try:
                session._append_history(
                    {"role": "assistant", "content": placeholder}
                )
            except Exception:
                logger.debug("Append stop placeholder failed", exc_info=True)
        try:
            session._turn_count += 1
        except Exception:
            pass
        try:
            session._persist_history()
        except Exception:
            logger.debug("Persist history on cancel failed", exc_info=True)
    except Exception:
        logger.debug("Mid-turn cancel finalization failed", exc_info=True)


async def _produce_turn(
    *,
    buf: BufferedTurnWriter,
    cid: str,
    project: Optional[str],
    model: Optional[str],
    user_input: str,
    session: Any,
    artifacts_root: Path,
    artifact_snapshot_before: dict,
    turn_index: int,
) -> None:
    """Drive anton-core's ``turn_stream`` into the buffer.

    Lives on its own ``asyncio.Task`` so closing the SSE consumer
    never reaches it. Every event from ``turn_stream`` becomes one
    JSONL record in the buffer; readers (HTTP / reconnect) tail the
    file independently.

    Failure modes:
      - **Natural completion** → ``buf.close("completed")``.
      - **Unrecoverable exception** → write Error record, then
        ``buf.close("error")``. The reader replays this as
        ``AntonRuntimeError`` so the route emits ``response.failed``.
      - **ENOENT (stale path)** → evict the session, write Error,
        close. Next request rebuilds against current paths.
      - **Anthropic tool_use/tool_result mismatch** → repair history,
        evict session, retry once. If retry fails, treat as
        unrecoverable.
      - **Explicit cancel** (``CancelledError``) → finalize history,
        close with reason="cancelled".

    Post-turn housekeeping (meta update, artifact reconcile) runs in
    the ``finally`` block regardless of how the turn ended.
    """
    retried = False
    partial_assistant_parts: list[str] = []
    try:
        from anton.core.llm.provider import StreamTextDelta as _StreamTextDelta
    except Exception:
        _StreamTextDelta = None

    def _write_event(event: Any) -> None:
        # Capture partial text for the cancel finalization path. This
        # mirrors what the legacy ``_stream()`` did, but only matters
        # on explicit cancel — consumer disconnect no longer triggers
        # any finalization.
        if _StreamTextDelta is not None and isinstance(event, _StreamTextDelta):
            try:
                partial_assistant_parts.append(event.text or "")
            except Exception:
                pass
        try:
            buf.append(type(event).__name__, _serialize_event(event))
        except Exception:
            logger.exception(
                "Failed to write turn event for conversation %s", cid,
            )

    nonlocal_session: dict[str, Any] = {"s": session}

    async def _drain(prompt: str) -> None:
        async for event in nonlocal_session["s"].turn_stream(prompt):
            _write_event(event)

    try:
        try:
            await _drain(user_input)
        except FileNotFoundError as exc:
            logger.warning(
                "Conversation %s hit ENOENT mid-turn; evicting cached "
                "session so the next attempt rebuilds. (%s)", cid, exc,
            )
            _evict_session(cid)
            buf.append("Error", {
                "code": "missing_file",
                "message": (
                    "A file referenced by this conversation went missing "
                    "(likely the project directory was moved or deleted). "
                    "Try sending the message again — it will recover automatically."
                ),
            })
            buf.close("error")
            return
        except asyncio.CancelledError:
            # Explicit cancel. Persist whatever partial state we had,
            # then propagate so the task ends in a CANCELLED state.
            await _finalize_history_on_explicit_cancel(
                nonlocal_session["s"], partial_assistant_parts,
            )
            buf.close("cancelled", {
                "partial_text_chars": sum(len(t) for t in partial_assistant_parts),
            })
            raise
        except Exception as exc:
            if not retried and _is_tool_use_error(exc):
                logger.warning(
                    "Conversation %s failed with tool_use/tool_result "
                    "mismatch — repairing history and retrying once.", cid,
                )
                try:
                    repair_history_if_needed(project, cid)
                except Exception:
                    logger.debug("Repair before retry failed", exc_info=True)
                _evict_session(cid)
                retried = True
                try:
                    nonlocal_session["s"] = await _resolve_session(cid, project, model)
                except Exception as resolve_exc:
                    logger.exception("Conversation %s resolve after repair failed", cid)
                    buf.append("Error", {"message": _safe_error(resolve_exc)})
                    buf.close("error")
                    return
                try:
                    await _drain(user_input)
                except asyncio.CancelledError:
                    await _finalize_history_on_explicit_cancel(
                        nonlocal_session["s"], partial_assistant_parts,
                    )
                    buf.close("cancelled")
                    raise
                except Exception as retry_exc:
                    logger.exception(
                        "Conversation %s retry after history repair also failed", cid,
                    )
                    buf.append("Error", {"message": _safe_error(retry_exc)})
                    buf.close("error")
                    return
            else:
                logger.exception("Conversation %s failed", cid)
                if "Errno 2" in str(exc) or "No such file or directory" in str(exc):
                    _evict_session(cid)
                buf.append("Error", {"message": _safe_error(exc)})
                buf.close("error")
                return

        # Natural completion.
        buf.close("completed")
    finally:
        # Post-turn housekeeping runs in every exit path. These calls
        # were previously inside ``_stream()``'s finally block; they
        # have the same contract (best-effort, swallow exceptions, never
        # block the next turn).
        try:
            _update_meta_after_turn(project, cid, nonlocal_session["s"].history)
        except Exception:
            logger.debug("Could not update conversation meta", exc_info=True)
        try:
            _reconcile_artifacts_after_turn(
                artifacts_root=artifacts_root,
                conversation_id=cid,
                project=project,
                user_input=user_input,
                turn_index=turn_index,
                snapshot_before=artifact_snapshot_before,
            )
        except Exception:
            logger.debug("Could not reconcile artifacts after turn", exc_info=True)


# ---------------------------------------------------------------------------
# Public chat API
# ---------------------------------------------------------------------------


async def chat_stream(
    user_input: str,
    *,
    conversation_id: Optional[str] = None,
    project: Optional[str] = None,
    model: Optional[str] = None,
    disabled_connections: Optional[list[dict[str, str]]] = None,
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
    if disabled_connections is not None:
        update_conversation(cid, disabled_connections=disabled_connections)

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

    # Pre-turn artifact snapshot. Pinned at the start of `_stream()`
    # rather than at chat_stream entry so it captures the state right
    # before the agent fires — covers retries cleanly (a retried turn
    # still diffs against the same baseline). Turn index is the
    # current count of user-role messages in history; the about-to-
    # fire turn slots in at this position.
    artifacts_root = _project_base(project) / "artifacts"
    try:
        from anton.core.artifacts import snapshot_dir as _snapshot_dir
        artifact_snapshot_before = _snapshot_dir(artifacts_root)
    except Exception:
        logger.debug("Could not snapshot artifacts dir pre-turn", exc_info=True)
        artifact_snapshot_before = {}
    turn_index = sum(1 for m in (session.history or []) if m.get("role") == "user")

    # Spawn the producer as a detached asyncio.Task. Anything that
    # cares about events (the SSE response, a reconnecting tail) reads
    # from the on-disk buffer at `buf_path`. Closing the SSE consumer
    # has zero effect on the producer.
    streams_dir = _project_base(project) / ".anton" / "streams"
    buf_path = turn_buffer_path(streams_dir, cid, turn_index)
    buf = BufferedTurnWriter(buf_path)
    handle = await _stream_registry.registry.start(
        conversation_id=cid,
        turn_id=turn_index,
        project=project,
        buffer=buf,
        producer_coro=_produce_turn(
            buf=buf,
            cid=cid,
            project=project,
            model=model,
            user_input=user_input,
            session=session,
            artifacts_root=artifacts_root,
            artifact_snapshot_before=artifact_snapshot_before,
            turn_index=turn_index,
        ),
    )

    return _read_handle_events(handle, from_seq=0), cid


async def _read_handle_events(handle, *, from_seq: int = 0) -> AsyncGenerator:
    """Tail a ``TurnHandle``'s buffer and yield anton-core events.

    Shared reader for both ``chat_stream`` (start-of-turn) and the
    Phase 2 ``tail_response`` endpoint (mid-turn reconnect). The two
    callers differ only in ``from_seq``: a fresh stream starts at 0;
    a reconnecting client passes whatever ``last_seen_seq`` they
    stored.

    Terminal records control the generator's lifetime:
      - ``Done``        → end the generator cleanly.
      - ``Cancelled`` / ``Interrupted`` → also end cleanly; the
        buffer has already captured everything the consumer should
        see, and the cancel placeholder (if any) lives in persisted
        history.
      - ``Error``       → raise ``AntonRuntimeError`` so the route
        emits ``response.failed`` — preserves the existing
        exception-based control flow at the route layer.

    Safe to cancel at any time (client closes the tab, fetch aborts):
    the underlying producer task is unaffected.
    """
    async for rec in tail_buffer(handle.buffer, from_seq=from_seq):
        if rec.type == "Error":
            msg = rec.data.get("message") or "Anton encountered an unexpected error."
            raise AntonRuntimeError(msg)
        if rec.type in ("Done", "Cancelled", "Interrupted"):
            return
        event = _reconstruct_event(rec)
        if event is not None:
            yield event


async def cancel_in_flight(conversation_id: str) -> bool:
    """Phase 3 — cancel the in-flight producer task for a conversation.

    Returns ``True`` if a running task was cancelled, ``False`` if
    there was nothing to cancel (no handle, or the producer had
    already finished). Idempotent — safe for the renderer to call
    even if it lost track of the in-flight state.

    The actual finalization (history seal + persist + buffer
    ``Cancelled`` terminal) happens inside ``_produce_turn``'s
    ``CancelledError`` branch. This helper only delivers the signal.
    """
    return await _stream_registry.registry.cancel(conversation_id)


def tail_conversation(
    conversation_id: str, *, from_seq: int = 0,
) -> Optional[AsyncIterator]:
    """Return an event iterator tailing the in-flight (or
    just-finished) buffer for *conversation_id*.

    Returns ``None`` when no buffer exists in the registry — the
    caller should fall back to the persisted history endpoint.
    A returning client is expected to pass ``from_seq`` so events
    they already rendered aren't replayed.

    Phase 2 contract: only looks in the in-memory registry. Phase 4
    (boot-time interrupted-sweep) makes restart cases visible via the
    same buffers, but those are already terminated — the iterator
    yields nothing and exits.
    """
    handle = _stream_registry.registry.get(conversation_id)
    if handle is None:
        return None
    return _read_handle_events(handle, from_seq=from_seq)


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
            if "disabled_connections" not in meta:
                meta["disabled_connections"] = []
            else:
                meta["disabled_connections"] = normalize_disabled_connections(
                    meta.get("disabled_connections"),
                )
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
            if "disabled_connections" not in data:
                data["disabled_connections"] = []
            else:
                data["disabled_connections"] = normalize_disabled_connections(
                    data.get("disabled_connections"),
                )
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
                    "disabled_connections": [],
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
    allowed = {"title", "disabled_connections"}
    evict_session = False
    for k, v in patch.items():
        if k not in allowed:
            continue
        if k == "title":
            if v is None:
                continue
            cleaned = sanitize_title(v)
            # Empty-after-sanitization → preserve the existing title
            # instead of blanking it. Callers that genuinely want a
            # reset can pass an explicit "" via a future field; for
            # now treat empty as a no-op so a stray rename to "  " is
            # harmless rather than wiping the conversation label.
            if cleaned is None:
                continue
            meta[k] = cleaned
        elif k == "disabled_connections":
            if v is None:
                continue
            meta[k] = normalize_disabled_connections(v)
            evict_session = True
    meta["id"] = conversation_id
    if not meta.get("project"):
        meta["project"] = project_name
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        _atomic_write(meta_path, meta)
    except Exception:
        logger.debug("Could not update conversation meta", exc_info=True)
    if evict_session:
        _evict_session(conversation_id)
    return meta


def _is_user_input_message(msg: object) -> bool:
    """True iff this is a real user-typed message (vs a tool_result
    user message that anton inserts mid-turn, OR a SYSTEM: error-
    recovery prompt anton appends after a tool failure). User input
    messages are the boundaries between displayable turns.

    MUST stay in sync with `_parse_for_display`'s filter in
    `routes/conversations.py` — both must skip the same messages, or
    the renderer's trash-button turn index won't match what
    `delete_turn` operates on, and deleting bubble N silently
    removes a different slice on the server side.
    """
    if not isinstance(msg, dict):
        return False
    if msg.get("role") != "user":
        return False
    content = msg.get("content")
    if isinstance(content, str):
        if not content:
            return False
        # Skip anton-core's auto-retry / failure-recovery prompts —
        # they live in `_history.json` (the LLM needs them as
        # context on the next turn) but the user never typed them
        # and `_parse_for_display` strips them from the chat
        # render. Anything starting with "SYSTEM:" is treated the
        # same way; legit user text starting with that token is
        # vanishingly unlikely.
        if content.lstrip().startswith("SYSTEM:"):
            return False
        return True
    if isinstance(content, list):
        # Multi-block user messages can carry tool_result + text
        # blocks side by side. We only count the message as a
        # user-input boundary when it actually carries typed text;
        # purely-tool_result messages (anton's mid-turn responses)
        # are skipped. Same SYSTEM: filter applies to the text
        # blocks for consistency with the string-content path.
        text_blocks = [
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        if not any(text_blocks):
            return False
        joined = "\n".join(text_blocks).lstrip()
        if joined.startswith("SYSTEM:"):
            return False
        return True
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
    _live.pop(conversation_id, None)
    located = _find_conversation_dir(conversation_id)
    if not located:
        return False
    _, ep = located
    # Glob for every file whose name starts with "<id>." or "<id>_" so we
    # catch the known suffixes (_meta.json, _history.json, _turns.json,
    # .jsonl) plus any file the Anton library may write in the future.
    # Using startswith checks instead of Path.glob avoids glob-escaping
    # issues with conversation IDs that contain special characters.
    dot_pfx = f"{conversation_id}."
    under_pfx = f"{conversation_id}_"
    found = False
    for p in list(ep.iterdir()):
        if not p.is_file():
            continue
        name = p.name
        if name == conversation_id or name.startswith(dot_pfx) or name.startswith(under_pfx):
            try:
                p.unlink()
                found = True
            except Exception:
                pass
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
