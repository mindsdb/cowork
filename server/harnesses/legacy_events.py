"""Harness-local adapters from legacy Responses payloads to Cowork events."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from runtime.schemas import CoworkEvent, now_ms


def normalize_legacy_payload(payload: dict[str, Any], turn_id: str) -> CoworkEvent:
    events = normalize_legacy_payloads(payload, turn_id)
    return events[0]


def normalize_legacy_payloads(
    payload: dict[str, Any],
    turn_id: str,
    *,
    project_root: str | None = None,
) -> list[CoworkEvent]:
    legacy_type = str(payload.get("type") or "")
    at_ms = payload.get("at_ms")
    if not isinstance(at_ms, int):
        at_ms = now_ms()

    event_type = "reasoning"
    event_payload: dict[str, Any] = {
        "legacy": payload,
        "legacy_type": legacy_type,
    }

    if legacy_type == "response.output_text.delta":
        event_type = "message.delta"
        event_payload.update({
            "delta": str(payload.get("delta") or ""),
            "label": "Response",
            "status": "streaming",
        })
    elif legacy_type == "response.completed":
        event_type = "response.completed"
        event_payload.update({"label": "Response complete", "status": "completed"})
    elif legacy_type == "response.failed":
        event_type = "response.failed"
        event_payload.update({
            "label": "Response failed",
            "status": "failed",
            "code": payload.get("code") or "",
            "message": payload.get("error") or payload.get("message") or "Response failed",
        })
    elif legacy_type == "response.created":
        event_type = "response.created"
        event_payload.update({"label": "Response started", "status": "started"})
    elif legacy_type == "response.in_progress":
        phase = str(payload.get("phase") or "")
        status = str(payload.get("progress_status") or "completed")
        if phase == "tool":
            if status == "started":
                event_type = "tool.started"
            elif status == "failed":
                event_type = "tool.failed"
            else:
                event_type = "tool.completed"
            event_payload.update({
                "label": payload.get("message") or payload.get("content") or payload.get("tool_name") or "Tool",
                "status": status,
                "tool_name": payload.get("tool_name") or "",
                "message": payload.get("message") or payload.get("content") or "",
            })
        elif phase == "artifact" or isinstance(payload.get("artifact"), dict):
            event_type = "artifact.created"
            artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else {}
            event_payload.update({
                "label": payload.get("message") or artifact.get("title") or "Artifact",
                "status": status,
                "artifact": artifact,
            })
        else:
            event_type = "reasoning"
            event_payload.update({
                "label": payload.get("message") or payload.get("content") or phase or "Progress",
                "status": status,
                "phase": phase,
                "message": payload.get("message") or payload.get("content") or "",
            })
    elif legacy_type in {
        "tool.requested",
        "tool.started",
        "tool.completed",
        "tool.failed",
        "file.accessed",
        "source.used",
        "approval.required",
        "approval.granted",
        "approval.denied",
        "approval.bypassed",
        "access.denied",
        "artifact.ignored",
        "response.cancelled",
    }:
        event_type = legacy_type
        event_payload.update({
            key: value
            for key, value in payload.items()
            if key not in {"type", "at_ms"}
        })

    base = CoworkEvent(type=event_type, turn_id=turn_id, at_ms=at_ms, payload=event_payload)
    extras = _typed_events_from_payload(payload, turn_id, at_ms, project_root=project_root)
    return [base, *extras]


_APP_INTERNAL_PARTS = {".cowork", ".anton"}


def _project_path_mentions(payload: dict[str, Any], project_root: str | None) -> list[str]:
    if not project_root:
        return []
    try:
        raw_root = Path(project_root).expanduser()
        resolved_root = raw_root.resolve(strict=False)
    except Exception:
        return []
    text_parts: list[str] = []
    for key in ("message", "content", "path", "file_path", "stdout", "stderr", "command"):
        value = payload.get(key)
        if isinstance(value, str):
            text_parts.append(value)
    text = "\n".join(text_parts)
    if not text:
        return []
    roots = [resolved_root]
    if str(raw_root) != str(resolved_root):
        roots.append(raw_root)
    out: list[str] = []
    seen: set[str] = set()
    for root in roots:
        pattern = re.compile(re.escape(str(root)) + r"[^\s'\"),;]+")
        for match in pattern.finditer(text):
            raw = match.group(0).rstrip(".,:;")
            try:
                path = Path(raw).resolve(strict=False)
                rel = path.relative_to(resolved_root)
            except Exception:
                continue
            if not rel.parts:
                continue
            if rel.parts[0] in _APP_INTERNAL_PARTS or rel.parts[0] == "artifacts":
                continue
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


def _approval_required(payload: dict[str, Any]) -> str:
    text = "\n".join(
        str(value)
        for key in ("message", "content", "error")
        for value in (payload.get(key),)
        if isinstance(value, str)
    )
    if not text:
        return ""
    lowered = text.lower()
    if "approval required" not in lowered and "requires approval" not in lowered:
        return ""
    return text.strip()[:2048]


def _typed_events_from_payload(
    payload: dict[str, Any],
    turn_id: str,
    at_ms: int,
    *,
    project_root: str | None,
) -> list[CoworkEvent]:
    if payload.get("type") != "response.in_progress":
        return []
    phase = str(payload.get("phase") or "")
    status = str(payload.get("progress_status") or "completed")
    tool_name = str(payload.get("tool_name") or payload.get("tool") or "")
    typed: list[CoworkEvent] = []

    paths = _project_path_mentions(payload, project_root)
    file_tool = any(token in tool_name.lower() for token in ("file", "read", "write", "edit", "search", "grep", "rg"))
    if paths and (phase == "tool" or file_tool):
        for path in paths:
            typed.append(CoworkEvent(
                type="file.accessed",
                turn_id=turn_id,
                at_ms=at_ms,
                payload={
                    "path": path,
                    "label": Path(path).name,
                    "status": status,
                    "tool_name": tool_name,
                    "mode": "write" if any(token in tool_name.lower() for token in ("write", "edit")) else "read",
                },
            ))
            typed.append(CoworkEvent(
                type="source.used",
                turn_id=turn_id,
                at_ms=at_ms,
                payload={
                    "source_path": path,
                    "label": Path(path).name,
                    "status": status,
                    "tool_name": tool_name,
                },
            ))

    approval_message = _approval_required(payload)
    if approval_message:
        typed.append(CoworkEvent(
            type="approval.required",
            turn_id=turn_id,
            at_ms=at_ms,
            payload={
                "label": "Approval required",
                "status": "started",
                "message": approval_message,
                "tool_name": tool_name,
            },
        ))

    return typed
