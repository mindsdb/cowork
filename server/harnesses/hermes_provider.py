"""Hermes Agent harness provider.

Hermes owns the agent runtime. Cowork owns the per-session display store so
the existing sidebar, task view, and conversation reload flow keep working
without requiring Anton's history format.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator
from urllib import error as url_error
from urllib import request as url_request

from anton_api import projects_store
from anton_api.models import (
    ResponseObject,
    ResponseOutput,
    ResponseOutputContent,
    ResponseStatus,
    Role,
)

from .base import HarnessConfigurationError, HarnessRuntimeError
from .config import hermes_api_key, hermes_base_url


logger = logging.getLogger(__name__)

_TITLE_MAX_LEN = 160
_TITLE_WHITESPACE_RE = re.compile(r"\s+")
_ATTACHMENT_MARKER = "\n\nAttached context supplied by the user:"
_MAX_CONTEXT_CHARS = 18_000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_conversation_id() -> str:
    return (
        datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        + "_"
        + uuid.uuid4().hex[:6]
    )


def _sanitize_title(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = _TITLE_WHITESPACE_RE.sub(" ", value).strip()
    if _ATTACHMENT_MARKER in cleaned:
        cleaned = cleaned.split(_ATTACHMENT_MARKER, 1)[0].strip()
    if not cleaned:
        return None
    return cleaned[:_TITLE_MAX_LEN].strip()


def _text_for_message(message: dict) -> str:
    content = message.get("content", "")
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return str(content or "")


class HermesHarnessProvider:
    id = "hermes"
    label = "Hermes Agent"

    async def health(self) -> dict:
        try:
            health_payload = await asyncio.to_thread(self._get_json, "/health", 2.0)
            models_payload = await asyncio.to_thread(self._get_json, "/v1/models", 2.0)
            models = models_payload.get("data") if isinstance(models_payload, dict) else []
            return {
                "id": self.id,
                "label": self.label,
                "available": True,
                "base_url": self.base_url,
                "status": health_payload.get("status", "ok") if isinstance(health_payload, dict) else "ok",
                "models": models if isinstance(models, list) else [],
            }
        except Exception as exc:
            return {
                "id": self.id,
                "label": self.label,
                "available": False,
                "base_url": self.base_url,
                "error": str(exc),
            }

    @property
    def base_url(self) -> str:
        return hermes_base_url()

    @property
    def api_key(self) -> str:
        return hermes_api_key()

    def list_live(self) -> list[str]:
        return []

    async def close_all(self) -> None:
        return None

    # ------------------------------------------------------------------
    # Conversation storage
    # ------------------------------------------------------------------

    def _project_base(self, project: str | None) -> Path:
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

    def _episodes_dir(self, project: str | None) -> Path:
        return self._project_base(project) / ".cowork" / "hermes" / "episodes"

    def _meta_path(self, project: str | None, conversation_id: str) -> Path:
        return self._episodes_dir(project) / f"{conversation_id}_meta.json"

    def _history_path(self, project: str | None, conversation_id: str) -> Path:
        return self._episodes_dir(project) / f"{conversation_id}_history.json"

    def _turns_path(self, project: str | None, conversation_id: str) -> Path:
        return self._episodes_dir(project) / f"{conversation_id}_turns.json"

    def _candidate_episode_dirs(self, project: str | None = None) -> list[tuple[str, Path]]:
        projects_store.ensure_projects_dir()
        if project == "all":
            out: list[tuple[str, Path]] = []
            for proj in projects_store.list_projects():
                ep = Path(proj["path"]) / ".cowork" / "hermes" / "episodes"
                if ep.is_dir():
                    out.append((proj["name"], ep))
            return out
        if project:
            _, base = projects_store.resolve_project(project)
            ep = base / ".cowork" / "hermes" / "episodes"
            return [(project, ep)] if ep.is_dir() else []
        project_name, base = projects_store.resolve_project(None)
        ep = base / ".cowork" / "hermes" / "episodes"
        return [(project_name, ep)] if ep.is_dir() else []

    def _find_conversation_dir(self, conversation_id: str) -> tuple[str, Path] | None:
        for project_name, ep_dir in self._candidate_episode_dirs("all"):
            for suffix in ("_meta.json", "_history.json", "_turns.json"):
                if (ep_dir / f"{conversation_id}{suffix}").is_file():
                    return project_name, ep_dir
        return None

    @staticmethod
    def _atomic_write(path: Path, payload: Any) -> None:
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

    def _load_json(self, path: Path, fallback: Any) -> Any:
        if not path.is_file():
            return fallback
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            return loaded if loaded is not None else fallback
        except Exception:
            return fallback

    def _load_meta(self, project: str | None, conversation_id: str) -> dict | None:
        data = self._load_json(self._meta_path(project, conversation_id), None)
        return data if isinstance(data, dict) else None

    def _load_history(self, project: str | None, conversation_id: str) -> list[dict]:
        data = self._load_json(self._history_path(project, conversation_id), [])
        return data if isinstance(data, list) else []

    def _save_history(self, project: str | None, conversation_id: str, history: list[dict]) -> None:
        self._atomic_write(self._history_path(project, conversation_id), history)

    def _save_meta(self, project: str | None, conversation_id: str, meta: dict) -> None:
        self._atomic_write(self._meta_path(project, conversation_id), meta)

    def _conversation_project(self, conversation_id: str, fallback: str | None = None) -> str | None:
        located = self._find_conversation_dir(conversation_id)
        if located:
            return located[0]
        return fallback

    def _ensure_conversation(
        self,
        *,
        conversation_id: str | None,
        project: str | None,
        first_user_input: str,
        disabled_connections: list[dict] | None,
    ) -> tuple[str, str | None, dict, list[dict]]:
        cid = conversation_id or _new_conversation_id()
        project_name = self._conversation_project(cid, project)
        if project_name is None:
            project_name, _ = projects_store.resolve_project(project)

        history = self._load_history(project_name, cid)
        meta = self._load_meta(project_name, cid) or {}
        now = _now_iso()
        preview = _sanitize_title(first_user_input) or cid
        meta.setdefault("id", cid)
        meta.setdefault("title", preview[:80])
        meta.setdefault("created_at", now)
        meta["updated_at"] = now
        meta["project"] = project_name
        meta["harness"] = self.id
        meta["preview"] = meta.get("preview") or preview[:60]
        meta["turns"] = sum(1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user")
        if disabled_connections is not None:
            meta["disabled_connections"] = disabled_connections
        else:
            meta.setdefault("disabled_connections", [])
        self._save_meta(project_name, cid, meta)
        return cid, project_name, meta, history

    def _append_message(self, project: str | None, conversation_id: str, role: str, content: str) -> list[dict]:
        history = self._load_history(project, conversation_id)
        history.append({"role": role, "content": content})
        self._save_history(project, conversation_id, history)

        meta = self._load_meta(project, conversation_id) or {"id": conversation_id}
        now = _now_iso()
        meta["updated_at"] = now
        meta.setdefault("created_at", now)
        meta["project"] = project
        meta["harness"] = self.id
        meta["turns"] = sum(1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user")
        user_preview = next(
            (_sanitize_title(_text_for_message(msg)) for msg in history if isinstance(msg, dict) and msg.get("role") == "user"),
            None,
        )
        if user_preview:
            meta.setdefault("title", user_preview[:80])
            meta["preview"] = user_preview[:60]
        self._save_meta(project, conversation_id, meta)
        return history

    def list_conversations(self, limit: int = 200, project: str | None = None) -> list[dict]:
        out: list[dict] = []
        for project_name, ep_dir in self._candidate_episode_dirs(project):
            for path in ep_dir.iterdir():
                if not path.name.endswith(("_meta.json", "_history.json")):
                    continue
                cid = path.name.removesuffix("_meta.json").removesuffix("_history.json")
                if any(conv["id"] == cid for conv in out):
                    continue
                meta = self._load_json(ep_dir / f"{cid}_meta.json", {})
                if not isinstance(meta, dict):
                    meta = {}
                history = self._load_json(ep_dir / f"{cid}_history.json", [])
                if not isinstance(history, list):
                    history = []
                preview = ""
                for msg in history:
                    if isinstance(msg, dict) and msg.get("role") == "user":
                        preview = (_sanitize_title(_text_for_message(msg)) or "")[:60]
                        break
                meta.setdefault("id", cid)
                meta.setdefault("title", preview[:80] or cid)
                meta.setdefault("preview", preview)
                meta.setdefault("created_at", "")
                meta.setdefault("updated_at", "")
                meta["project"] = meta.get("project") or project_name
                meta["harness"] = self.id
                meta["turns"] = meta.get("turns") or sum(
                    1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user"
                )
                meta.setdefault("disabled_connections", [])
                out.append(meta)
        out.sort(key=lambda r: r.get("updated_at") or r.get("created_at") or "", reverse=True)
        return out[:limit]

    def get_conversation(self, conversation_id: str) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        project_name, ep = located
        meta = self._load_json(ep / f"{conversation_id}_meta.json", {})
        if not isinstance(meta, dict):
            meta = {}
        history = self._load_json(ep / f"{conversation_id}_history.json", [])
        if not isinstance(history, list):
            history = []
        meta.setdefault("id", conversation_id)
        meta.setdefault("project", project_name)
        meta.setdefault("harness", self.id)
        meta.setdefault("turns", sum(1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user"))
        meta.setdefault("disabled_connections", [])
        return meta

    def get_messages(self, conversation_id: str) -> list[dict] | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        _, ep = located
        history = self._load_json(ep / f"{conversation_id}_history.json", [])
        return history if isinstance(history, list) else []

    def load_turns(self, conversation_id: str) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        _, ep = located
        payload = self._load_json(ep / f"{conversation_id}_turns.json", None)
        return payload if isinstance(payload, dict) else None

    def record_turn_events(self, conversation_id: str, started_at_ms: int | None, events: list[dict]) -> None:
        if not events:
            return
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return
        _, ep = located
        path = ep / f"{conversation_id}_turns.json"
        payload = self._load_json(path, {})
        if not isinstance(payload, dict):
            payload = {}
        by_turn = payload.get("by_assistant_turn")
        if not isinstance(by_turn, dict):
            by_turn = {}
        history = self._load_json(ep / f"{conversation_id}_history.json", [])
        assistant_count = 0
        last_was_assistant = False
        if isinstance(history, list):
            for msg in history:
                if not isinstance(msg, dict) or msg.get("role") not in {"user", "assistant"}:
                    continue
                if msg.get("role") == "assistant":
                    if not last_was_assistant:
                        assistant_count += 1
                    last_was_assistant = True
                else:
                    last_was_assistant = False
        index = max(assistant_count - 1, 0)
        by_turn[str(index)] = {"started_at": started_at_ms, "events": events}
        payload["by_assistant_turn"] = by_turn
        self._atomic_write(path, payload)

    def update_conversation(self, conversation_id: str, **patch) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        project_name, ep = located
        path = ep / f"{conversation_id}_meta.json"
        meta = self._load_json(path, {})
        if not isinstance(meta, dict):
            meta = {}
        for key, value in patch.items():
            if key == "title":
                cleaned = _sanitize_title(value)
                if cleaned:
                    meta["title"] = cleaned
            elif key == "disabled_connections" and value is not None:
                meta["disabled_connections"] = value
        meta["id"] = conversation_id
        meta["project"] = project_name
        meta["harness"] = self.id
        meta["updated_at"] = _now_iso()
        self._atomic_write(path, meta)
        return meta

    def delete_turn(self, conversation_id: str, turn_index: int) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        _, ep = located
        history_path = ep / f"{conversation_id}_history.json"
        history = self._load_json(history_path, [])
        if not isinstance(history, list):
            return None
        user_indices = [
            index for index, msg in enumerate(history)
            if isinstance(msg, dict) and msg.get("role") == "user" and _text_for_message(msg)
        ]
        if turn_index < 0 or turn_index >= len(user_indices):
            return None
        start = user_indices[turn_index]
        end = user_indices[turn_index + 1] if turn_index + 1 < len(user_indices) else len(history)
        new_history = history[:start] + history[end:]
        self._atomic_write(history_path, new_history)

        turns_path = ep / f"{conversation_id}_turns.json"
        turns = self._load_json(turns_path, {})
        if isinstance(turns, dict):
            by_turn = turns.get("by_assistant_turn")
            if isinstance(by_turn, dict):
                shifted: dict[str, Any] = {}
                for key, value in by_turn.items():
                    try:
                        idx = int(key)
                    except (TypeError, ValueError):
                        continue
                    if idx == turn_index:
                        continue
                    if idx > turn_index:
                        idx -= 1
                    shifted[str(idx)] = value
                turns["by_assistant_turn"] = shifted
                self._atomic_write(turns_path, turns)
        return {
            "conversation_id": conversation_id,
            "turn_index": turn_index,
            "removed_count": end - start,
            "remaining_messages": len(new_history),
        }

    def delete_conversation(self, conversation_id: str) -> bool:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return False
        _, ep = located
        found = False
        for suffix in ("_meta.json", "_history.json", "_turns.json"):
            path = ep / f"{conversation_id}{suffix}"
            if path.is_file():
                try:
                    path.unlink()
                    found = True
                except Exception:
                    pass
        return found

    def move_conversation(self, conversation_id: str, target_project: str) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        src_project, src_ep = located
        if src_project == target_project:
            return self.get_conversation(conversation_id)
        _, target_base = projects_store.resolve_project(target_project)
        target_ep = target_base / ".cowork" / "hermes" / "episodes"
        target_ep.mkdir(parents=True, exist_ok=True)
        moved = False
        for suffix in ("_meta.json", "_history.json", "_turns.json"):
            src = src_ep / f"{conversation_id}{suffix}"
            if not src.is_file():
                continue
            dst = target_ep / f"{conversation_id}{suffix}"
            try:
                src.replace(dst)
                moved = True
            except Exception:
                logger.debug("Could not move Hermes conversation file", exc_info=True)
        if not moved:
            return None
        meta_path = target_ep / f"{conversation_id}_meta.json"
        meta = self._load_json(meta_path, {})
        if not isinstance(meta, dict):
            meta = {"id": conversation_id}
        meta["project"] = target_project
        meta["harness"] = self.id
        meta["updated_at"] = _now_iso()
        self._atomic_write(meta_path, meta)
        return meta

    # ------------------------------------------------------------------
    # Streaming and Hermes API mapping
    # ------------------------------------------------------------------

    async def stream_response(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> AsyncIterator[str]:
        cid, project_name, _meta, history_before = self._ensure_conversation(
            conversation_id=conversation_id,
            project=project,
            first_user_input=user_input,
            disabled_connections=disabled_connections,
        )
        prompt = self._build_prompt(history_before, user_input)
        self._append_message(project_name, cid, "user", user_input)
        artifact_snapshot = self._artifact_snapshot(project_name)

        recorded_events: list[dict] = []
        started_at_ms: int | None = None
        collected_text: list[str] = []
        seq = 0
        resp_id = f"resp-{uuid.uuid4().hex[:12]}"
        msg_id = f"msg-{uuid.uuid4().hex[:12]}"

        def _event(event_type: str, data: dict) -> str:
            nonlocal started_at_ms
            if "at_ms" not in data:
                data["at_ms"] = int(time.time() * 1000)
            if started_at_ms is None:
                started_at_ms = data["at_ms"]
            recorded_events.append({**data})
            return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

        try:
            health = await self.health()
            if not health.get("available"):
                raise HarnessConfigurationError(
                    f"Hermes Agent is not reachable at {self.base_url}: {health.get('error') or 'unknown error'}"
                )

            resp = ResponseObject(id=resp_id, model="hermes-agent", status=ResponseStatus.created)
            seq += 1
            yield _event(
                "response.created",
                {
                    "type": "response.created",
                    "sequence_number": seq,
                    "response": resp.model_dump(),
                    "conversation_id": cid,
                },
            )

            run_id = await self._create_run(
                prompt=prompt,
                session_id=cid,
                model=model,
                project_name=project_name,
            )
            async for event in self._iter_run_events(run_id):
                event_name = str(event.get("event") or event.get("type") or "")
                if event_name == "message.delta":
                    delta = str(event.get("delta") or "")
                    if not delta:
                        continue
                    collected_text.append(delta)
                    seq += 1
                    yield _event(
                        "response.output_text.delta",
                        {
                            "type": "response.output_text.delta",
                            "sequence_number": seq,
                            "item_id": msg_id,
                            "delta": delta,
                        },
                    )
                elif event_name == "reasoning.available":
                    content = str(event.get("text") or "").strip()
                    if content:
                        seq += 1
                        yield _event(
                            "response.in_progress",
                            {
                                "type": "response.in_progress",
                                "sequence_number": seq,
                                "thought_role": Role.thought_progress.value,
                                "phase": "reasoning",
                                "progress_status": "completed",
                                "message": content[:2048],
                                "content": content[:2048],
                            },
                        )
                elif event_name == "tool.started":
                    tool_name = str(event.get("tool") or "tool")
                    preview = str(event.get("preview") or tool_name)
                    seq += 1
                    yield _event(
                        "response.in_progress",
                        {
                            "type": "response.in_progress",
                            "sequence_number": seq,
                                "thought_role": Role.thought_progress.value,
                                "phase": "tool",
                                "progress_status": "started",
                                "message": preview[:2048],
                                "content": preview[:2048],
                                "tool_name": tool_name,
                        },
                    )
                elif event_name == "tool.completed":
                    tool_name = str(event.get("tool") or "tool")
                    error = event.get("error")
                    message = f"{tool_name} failed" if error else f"{tool_name} complete"
                    seq += 1
                    yield _event(
                        "response.in_progress",
                        {
                            "type": "response.in_progress",
                            "sequence_number": seq,
                                "thought_role": Role.thought_progress.value,
                                "phase": "tool",
                                "progress_status": "failed" if error else "completed",
                                "message": message,
                                "content": message,
                                "tool_name": tool_name,
                            "error": error,
                        },
                    )
                elif event_name == "run.completed":
                    output = str(event.get("output") or "")
                    if output and not collected_text:
                        collected_text.append(output)
                        seq += 1
                        yield _event(
                            "response.output_text.delta",
                            {
                                "type": "response.output_text.delta",
                                "sequence_number": seq,
                                "item_id": msg_id,
                                "delta": output,
                            },
                        )
                    full_text = "".join(collected_text)
                    self._append_message(project_name, cid, "assistant", full_text)
                    for artifact in self._scan_updated_artifacts(project_name, artifact_snapshot):
                        seq += 1
                        yield _event(
                            "response.in_progress",
                            {
                                "type": "response.in_progress",
                                "sequence_number": seq,
                                "thought_role": Role.thought_progress.value,
                                "phase": "artifact",
                                "progress_status": "completed",
                                "message": f"Created artifact: {artifact['title']}",
                                "content": json.dumps(artifact, ensure_ascii=False),
                                "artifact": artifact,
                            },
                        )
                    completed = ResponseObject(
                        id=resp_id,
                        model="hermes-agent",
                        status=ResponseStatus.completed,
                        output=[
                            ResponseOutput(
                                id=msg_id,
                                status=ResponseStatus.completed,
                                content=[ResponseOutputContent(text=full_text)],
                            )
                        ],
                    )
                    seq += 1
                    yield _event(
                        "response.completed",
                        {
                            "type": "response.completed",
                            "sequence_number": seq,
                            "response": completed.model_dump(),
                        },
                    )
                    return
                elif event_name == "run.failed":
                    raise HarnessRuntimeError(str(event.get("error") or "Hermes run failed"))

            raise HarnessRuntimeError("Hermes run ended without a completion event")
        except HarnessConfigurationError as exc:
            logger.warning("Hermes configuration error: %s", exc)
            yield _event(
                "response.failed",
                {"type": "response.failed", "code": "config_required", "error": str(exc)},
            )
        except Exception as exc:
            logger.exception("Hermes response stream failed")
            yield _event(
                "response.failed",
                {"type": "response.failed", "code": "hermes_error", "error": str(exc) or "Hermes Agent failed"},
            )
        finally:
            if recorded_events:
                try:
                    self.record_turn_events(cid, started_at_ms, recorded_events)
                except Exception:
                    logger.debug("Could not record Hermes turn events", exc_info=True)

    async def complete_text(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> tuple[str, str | None]:
        collected: list[str] = []
        seen_conversation_id = conversation_id
        async for chunk in self.stream_response(
            user_input=user_input,
            conversation_id=conversation_id,
            project=project,
            model=model,
            disabled_connections=disabled_connections,
        ):
            for payload in self._payloads_from_sse(chunk):
                if payload.get("type") == "response.created":
                    seen_conversation_id = payload.get("conversation_id") or seen_conversation_id
                elif payload.get("type") == "response.output_text.delta":
                    collected.append(str(payload.get("delta") or ""))
                elif payload.get("type") == "response.failed":
                    raise HarnessRuntimeError(str(payload.get("error") or "Hermes Agent failed"))
        return "".join(collected), seen_conversation_id

    def _build_prompt(self, history: list[dict], user_input: str) -> str:
        if not history:
            return user_input
        lines: list[str] = []
        total = 0
        for msg in history[-16:]:
            if not isinstance(msg, dict) or msg.get("role") not in {"user", "assistant"}:
                continue
            text = _text_for_message(msg).strip()
            if not text:
                continue
            label = "User" if msg.get("role") == "user" else "Assistant"
            entry = f"{label}: {text}"
            total += len(entry)
            lines.append(entry)
        transcript = "\n\n".join(lines)
        if len(transcript) > _MAX_CONTEXT_CHARS:
            transcript = transcript[-_MAX_CONTEXT_CHARS:]
        return (
            "Use the previous conversation only as context. Answer the latest user message.\n\n"
            f"Previous conversation:\n{transcript}\n\n"
            f"Latest user message:\n{user_input}"
        )

    def _artifact_root(self, project_name: str | None) -> Path:
        return self._project_base(project_name) / "artifacts"

    def _artifact_snapshot(self, project_name: str | None) -> dict[str, float]:
        root = self._artifact_root(project_name)
        if not root.is_dir():
            return {}
        snapshot: dict[str, float] = {}
        for metadata_path in root.glob("*/metadata.json"):
            if metadata_path.is_file():
                try:
                    snapshot[str(metadata_path.parent.resolve())] = self._artifact_folder_mtime(metadata_path.parent)
                except OSError:
                    continue
        return snapshot

    def _artifact_instructions(self, project_name: str | None) -> str:
        root = self._artifact_root(project_name)
        return (
            "\n\nCowork artifact bridge:\n"
            "When the user asks for an artifact-worthy output such as a report, dashboard, app, "
            "dataset, visualization, document, or reusable file, write it under this project "
            f"artifact root: {root}\n"
            "Use a slug folder: <artifact-root>/<slug>/.\n"
            "Each artifact folder must contain metadata.json, README.md, and one primary file.\n"
            "metadata.json must be valid JSON with at least: "
            "{\"name\":\"...\",\"description\":\"...\",\"type\":\"document|dataset|html-app|fullstack-stateless-app|mixed\","
            "\"primary\":\"relative/path/to/primary-file\"}.\n"
            "Only files inside that artifact root are surfaced in Anton Cowork Live Artifacts."
        )

    def _artifact_user_files(self, folder: Path) -> list[Path]:
        ignored = {"metadata.json", "README.md", ".published.json"}
        files: list[Path] = []
        for path in folder.rglob("*"):
            if not path.is_file():
                continue
            if path.name in ignored:
                continue
            if ".cowork-preview" in path.parts:
                continue
            files.append(path)
        return sorted(files)

    def _artifact_folder_mtime(self, folder: Path) -> float:
        latest = 0.0
        for path in folder.rglob("*"):
            if not path.is_file():
                continue
            try:
                latest = max(latest, path.stat().st_mtime)
            except OSError:
                continue
        return latest

    def _artifact_payload_from_folder(self, folder: Path) -> dict[str, Any] | None:
        metadata_path = folder / "metadata.json"
        if not metadata_path.is_file():
            return None
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Ignoring Hermes artifact with invalid metadata JSON: %s", metadata_path)
            return None
        if not isinstance(metadata, dict):
            logger.warning("Ignoring Hermes artifact metadata that is not an object: %s", metadata_path)
            return None

        primary: Path | None = None
        primary_hint = metadata.get("primary") or metadata.get("primaryFile") or metadata.get("entrypoint")
        if isinstance(primary_hint, str) and primary_hint.strip():
            candidate = (folder / primary_hint).resolve()
            try:
                candidate.relative_to(folder.resolve())
            except ValueError:
                logger.warning("Ignoring Hermes artifact primary outside artifact folder: %s", candidate)
                return None
            if candidate.is_file():
                primary = candidate
        if primary is None:
            user_files = self._artifact_user_files(folder)
            primary = user_files[0] if user_files else None
        if primary is None:
            logger.warning("Ignoring Hermes artifact without a primary file: %s", folder)
            return None

        title = str(metadata.get("name") or metadata.get("title") or folder.name).strip() or folder.name
        description = str(metadata.get("description") or "").strip()
        return {
            "title": title,
            "name": title,
            "description": description,
            "type": str(metadata.get("type") or "mixed"),
            "slug": str(metadata.get("slug") or folder.name),
            "folder": str(folder.resolve()),
            "path": str(primary.resolve()),
            "file_path": str(primary.resolve()),
            "primary": str(primary.relative_to(folder.resolve())),
            "metadata_path": str(metadata_path.resolve()),
        }

    def _scan_updated_artifacts(self, project_name: str | None, before: dict[str, float]) -> list[dict[str, Any]]:
        root = self._artifact_root(project_name)
        if not root.is_dir():
            return []
        artifacts: list[dict[str, Any]] = []
        for metadata_path in sorted(root.glob("*/metadata.json")):
            folder = metadata_path.parent
            try:
                folder_key = str(folder.resolve())
            except OSError:
                continue
            current_mtime = self._artifact_folder_mtime(folder)
            if folder_key in before and current_mtime <= before[folder_key]:
                continue
            payload = self._artifact_payload_from_folder(folder)
            if payload:
                artifacts.append(payload)
        return artifacts

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _get_json(self, path: str, timeout: float) -> dict:
        url = f"{self.base_url}{path}"
        req = url_request.Request(url, headers=self._headers(), method="GET")
        try:
            with url_request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
                return json.loads(body) if body else {}
        except url_error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise HarnessRuntimeError(f"{path} returned HTTP {exc.code}: {body[:300]}") from exc
        except url_error.URLError as exc:
            raise HarnessRuntimeError(str(exc.reason)) from exc

    def _post_json(self, path: str, payload: dict, timeout: float) -> dict:
        url = f"{self.base_url}{path}"
        req = url_request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )
        try:
            with url_request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
                return json.loads(body) if body else {}
        except url_error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise HarnessRuntimeError(f"{path} returned HTTP {exc.code}: {body[:300]}") from exc
        except url_error.URLError as exc:
            raise HarnessRuntimeError(str(exc.reason)) from exc

    async def _create_run(
        self,
        *,
        prompt: str,
        session_id: str,
        model: str | None,
        project_name: str | None,
    ) -> str:
        payload: dict[str, Any] = {
            "input": prompt,
            "session_id": session_id,
            "instructions": (
                "You are powering Anton Cowork through Hermes Agent. "
                "Use supplied context when useful and answer the latest user message directly."
                + self._artifact_instructions(project_name)
            ),
        }
        if model:
            payload["model"] = model
        data = await asyncio.to_thread(self._post_json, "/v1/runs", payload, 20.0)
        run_id = data.get("run_id") or data.get("id")
        if not run_id:
            raise HarnessRuntimeError("Hermes did not return a run_id.")
        return str(run_id)

    async def _iter_run_events(self, run_id: str) -> AsyncIterator[dict]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[object] = asyncio.Queue()
        url = f"{self.base_url}/v1/runs/{run_id}/events"

        def push(item: object) -> None:
            asyncio.run_coroutine_threadsafe(queue.put(item), loop)

        def worker() -> None:
            try:
                req = url_request.Request(url, headers=self._headers(), method="GET")
                with url_request.urlopen(req, timeout=75.0) as resp:
                    data_lines: list[str] = []
                    event_name = "message"
                    for raw in resp:
                        line = raw.decode("utf-8", "replace").rstrip("\r\n")
                        if not line:
                            if data_lines:
                                payload = "\n".join(data_lines)
                                data_lines = []
                                if payload.strip() == "[DONE]":
                                    break
                                try:
                                    parsed = json.loads(payload)
                                    if isinstance(parsed, dict):
                                        parsed.setdefault("event", event_name)
                                    else:
                                        parsed = {"event": event_name, "data": parsed}
                                    push(parsed)
                                except Exception:
                                    push({"event": event_name, "raw": payload})
                            event_name = "message"
                            continue
                        if line.startswith("event:"):
                            event_name = line[6:].strip() or "message"
                        elif line.startswith("data:"):
                            data_lines.append(line[5:].lstrip())
            except Exception as exc:
                push(exc)
            finally:
                push(None)

        thread = threading.Thread(target=worker, name="hermes-run-events", daemon=True)
        thread.start()
        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                raise HarnessRuntimeError(str(item)) from item
            if isinstance(item, dict):
                yield item

    @staticmethod
    def _payloads_from_sse(chunk: str) -> list[dict]:
        payloads: list[dict] = []
        for block in chunk.split("\n\n"):
            data_lines = [
                line[5:].lstrip()
                for line in block.splitlines()
                if line.startswith("data:")
            ]
            if not data_lines:
                continue
            try:
                parsed = json.loads("\n".join(data_lines))
                if isinstance(parsed, dict):
                    payloads.append(parsed)
            except Exception:
                continue
        return payloads
