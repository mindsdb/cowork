"""GET /v1/conversations and friends — persistent conversation records.

Returns Anton-side data only (id, title, turns, preview, timestamps,
project, messages). Cowork-side metadata (pinned, attachments) lives
on the cowork-side routes (/v1/pins, /v1/attachments) and is merged
client-side into the UI "task" object.

Conversations are scoped to a project (folder under projects_store):
  GET /v1/conversations                     → active project
  GET /v1/conversations?project=<name>      → that project
  GET /v1/conversations?project=all         → merged across all projects
  GET /v1/projects/{name}/conversations     → convenience alias
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException

from anton_api import conversation_manager, projects_store
from anton_api.models import ConversationPatch
from .cowork_state import load_state


router = APIRouter(tags=["conversations"])


def _schedule_runs_index() -> dict[str, str]:
    """Flat map: conversation_id → schedule_id, built from
    state["schedule_runs"]. Used to backfill `scheduled_id` on each
    listed conversation so the sidebar can group scheduled tasks
    even before /v1/schedules has been refetched."""
    index: dict[str, str] = {}
    try:
        state = load_state() or {}
    except Exception:
        return index
    runs = state.get("schedule_runs")
    if not isinstance(runs, dict):
        return index
    for schedule_id, bucket in runs.items():
        if not isinstance(bucket, list):
            continue
        for record in bucket:
            if not isinstance(record, dict):
                continue
            # Run records use camelCase (`sessionId`) per the writer in
            # routes/schedules.py:_append_run_record. Accept snake_case
            # too so a future writer change can't silently break this.
            sid = record.get("sessionId") or record.get("session_id")
            if sid:
                index[sid] = schedule_id
    return index


def _schedule_prompt_index() -> dict[tuple[str, str], str]:
    """Fallback (title, project) → schedule_id map. Catches the case
    where a schedule run errored before chat_stream returned a real
    conversation_id — the schedule recorded a synthetic `sched_xxxxx`
    in `schedule_runs`, but a real conversation file still exists and
    its title matches the schedule's prompt. Without this fallback the
    UI shows those errored runs as ungrouped duplicates."""
    out: dict[tuple[str, str], str] = {}
    try:
        state = load_state() or {}
    except Exception:
        return out
    schedules = state.get("schedules")
    if not isinstance(schedules, list):
        return out
    for s in schedules:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        prompt = (s.get("prompt") or "").strip()
        if not sid or not prompt:
            continue
        project = (s.get("project") or "").strip() or "general"
        # Anton stores conversation titles from the first 60 chars of
        # the user message, so match on `startswith` of either side to
        # be robust to truncation in either direction.
        out[(prompt[:60], project)] = sid
        out[(prompt, project)] = sid
    return out


def _annotate_with_schedule_id(conversations: list[dict]) -> list[dict]:
    """Tag each conversation entry with `scheduled_id` if it's a known
    schedule run (by registered sessionId, or by matching the
    schedule's prompt and project). Idempotent — preserves any
    existing field."""
    if not conversations:
        return conversations
    by_id = _schedule_runs_index()
    by_prompt = _schedule_prompt_index() if conversations else {}
    if not by_id and not by_prompt:
        return conversations
    for conv in conversations:
        if not isinstance(conv, dict) or conv.get("scheduled_id"):
            continue
        cid = conv.get("id")
        # Primary: the sessionId that the schedule writer recorded.
        if cid and cid in by_id:
            conv["scheduled_id"] = by_id[cid]
            continue
        # Fallback: title + project match against a known schedule's
        # prompt. Covers orphan conversations whose run record holds a
        # synthetic id (errored runs) but whose real conversation file
        # still exists on disk.
        title = (conv.get("title") or "").strip()
        project = (conv.get("project") or "").strip() or "general"
        if not title:
            continue
        match = by_prompt.get((title, project)) or by_prompt.get((title[:60], project))
        if match:
            conv["scheduled_id"] = match
    return conversations


_ATTACHMENT_MARKER = "\n\nAttached context supplied by the user:"

# Matches lines like: ### image.jpg (image/jpeg)
_ATTACHMENT_HEADER_RE = re.compile(r"^###\s+(.+?)\s+\(([^)]+)\)\s*$", re.MULTILINE)


def _strip_attachment_context(content: str) -> tuple[str, list[dict]]:
    """Strip the appended attachment context and return (clean_text, attachments).

    The attachment block is injected by ``_assembled_user_input`` when the
    user sends files alongside their message.  We parse it into structured
    attachment metadata so the frontend can render file chips on reload,
    then remove the block from the display text.
    """
    if _ATTACHMENT_MARKER not in content:
        return content, []
    text, attachment_block = content.split(_ATTACHMENT_MARKER, 1)
    attachments = [
        {"id": f"recovered_{i}", "name": m.group(1), "mime": m.group(2)}
        for i, m in enumerate(_ATTACHMENT_HEADER_RE.finditer(attachment_block))
    ]
    return text.rstrip(), attachments


def _parse_for_display(
    history: list[dict],
    *,
    turns: dict | None = None,
) -> list[dict]:
    """Filter raw history into one displayable entry per user→answer
    cycle and attach per-turn event metadata.

    Anton's history often contains MULTIPLE assistant messages between
    two user messages (a brief acknowledgement, then a tool-use phase,
    then the final answer). During live streaming the client only sees
    the final composed assistant turn, but `_history.json` keeps each
    intermediate text response as its own entry. If we surfaced each
    as a separate bubble the conversation would render very differently
    after a reload than during streaming — most visibly, a brief intro
    gets its own bubble, then the actual answer (with thinking +
    artifacts) gets ANOTHER, when they should be one.

    So we merge consecutive assistant text messages into a single
    bubble with content joined by blank lines. The events sidecar lives
    per "displayable turn" (matching `record_turn_events`'s filter), so
    a merged bubble inherits the events of its last segment — which is
    where scratchpad cells and artifacts actually came from.
    """
    by_assistant_turn = (
        turns.get("by_assistant_turn", {}) if isinstance(turns, dict) else {}
    )

    out: list[dict] = []
    assistant_idx = 0
    for msg in history:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content", "")
        if role not in ("user", "assistant") or not content:
            continue
        if isinstance(content, list):
            content = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
        if not content:
            continue
        attachments: list[dict] = []
        if role == "user":
            text, attachments = _strip_attachment_context(str(content))
        else:
            text = str(content)
        # A user message is displayable if it has text OR attachments.
        if role == "user" and not text and not attachments:
            continue
        # Skip anton-core's auto-recovery prompts. When a tool call
        # fails mid-stream, anton appends a synthetic
        # `{role: "user", content: "SYSTEM: An error interrupted
        # execution: …"}` message to history so the LLM can self-
        # correct on the next turn (anton/core/session.py:952). They
        # must remain in _history.json (anton needs them as context
        # next turn) but rendering them as user bubbles in the chat
        # is confusing — the user never typed them, they read like
        # the conversation went off the rails. Two known prefixes:
        #   "SYSTEM: An error interrupted execution: …" — single retry
        #   "SYSTEM: The task has failed N times. Latest error: …" — retries exhausted
        # Anything else starting with SYSTEM: is treated the same way
        # to be safe; user-typed content that legitimately starts
        # with that token is vanishingly unlikely.
        if role == "user" and text.lstrip().startswith("SYSTEM:"):
            continue
        if role == "assistant":
            if not text:
                continue
            # Merge with the previous bubble if it's also assistant —
            # this is the same user→answer cycle, just split into
            # multiple internal text emissions.
            if out and out[-1]["role"] == "assistant":
                prev = out[-1]
                prev["content"] = f"{prev['content'].rstrip()}\n\n{text}"
                # The events sidecar slot for this cycle is keyed by
                # the merged bubble's index. record_turn_events writes
                # at displayable_count - 1, which lines up with the
                # current `assistant_idx - 1` since we just merged.
                idx = max(0, assistant_idx - 1)
                saved = by_assistant_turn.get(str(idx))
                if isinstance(saved, dict):
                    events = saved.get("events")
                    started_at = saved.get("started_at")
                    if isinstance(events, list) and events:
                        prev["events"] = events
                    if started_at is not None and "startedAt" not in prev:
                        prev["startedAt"] = started_at
                continue

            entry: dict = {"role": role, "content": text}
            saved = by_assistant_turn.get(str(assistant_idx))
            assistant_idx += 1
            if isinstance(saved, dict):
                events = saved.get("events")
                started_at = saved.get("started_at")
                if isinstance(events, list) and events:
                    entry["events"] = events
                if started_at is not None:
                    entry["startedAt"] = started_at
            out.append(entry)
        else:
            entry = {"role": role, "content": text}
            if attachments:
                entry["attachments"] = attachments
            out.append(entry)
    return out


@router.get("/v1/conversations")
async def list_conversations(limit: int = 200, project: str | None = None):
    target = project if project else projects_store.get_active()
    return {
        "project": target,
        "conversations": _annotate_with_schedule_id(
            conversation_manager.list_conversations(limit=limit, project=target)
        ),
    }


@router.get("/v1/projects/{name}/conversations")
async def list_project_conversations(name: str, limit: int = 200):
    return {
        "project": name,
        "conversations": _annotate_with_schedule_id(
            conversation_manager.list_conversations(limit=limit, project=name)
        ),
    }


@router.get("/v1/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    meta = conversation_manager.get_conversation(conversation_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return meta


@router.get("/v1/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    messages = conversation_manager.get_messages(conversation_id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    # Sidecar may not exist for older conversations — that's fine, the
    # client just won't see events on those turns.
    turns = conversation_manager.load_turns(conversation_id)
    return {
        "id": conversation_id,
        "messages": _parse_for_display(messages, turns=turns),
    }


@router.patch("/v1/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, patch: ConversationPatch):
    updates = patch.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    # Project move is a different operation from a title update —
    # it physically relocates the conversation between project dirs.
    target_project = updates.pop("project", None)
    meta = None
    if target_project is not None:
        try:
            meta = conversation_manager.move_conversation(conversation_id, target_project)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        if meta is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

    if updates:
        meta = conversation_manager.update_conversation(conversation_id, **updates)
        if meta is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

    return meta or {"id": conversation_id}


@router.delete("/v1/conversations/{conversation_id}/turns/{turn_index}")
async def delete_conversation_turn(conversation_id: str, turn_index: int):
    """Delete one user→answer cycle from a conversation. The client
    passes the 0-based displayable bubble index of the assistant
    message; the server removes that user input + all assistant
    messages anton produced in response, then reindexes the events
    sidecar so subsequent turns shift down by one.
    """
    if turn_index < 0:
        raise HTTPException(status_code=400, detail="turn_index must be non-negative")
    result = conversation_manager.delete_turn(conversation_id, turn_index)
    if result is None:
        raise HTTPException(status_code=404, detail="Turn not found")
    return result


@router.delete("/v1/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    found = conversation_manager.delete_conversation(conversation_id)
    if not found:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "id": conversation_id}
