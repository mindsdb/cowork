"""Transport conversion from canonical Cowork events to Responses SSE."""

from __future__ import annotations

import json
from typing import Any

from .schemas import CoworkEvent


def iter_sse_payloads(chunk: str) -> list[tuple[str, dict[str, Any]]]:
    payloads: list[tuple[str, dict[str, Any]]] = []
    for block in chunk.split("\n\n"):
        if not block.strip():
            continue
        event_type = ""
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event_type = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not data_lines:
            continue
        try:
            payload = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            payloads.append((event_type or str(payload.get("type") or ""), payload))
    return payloads


def _legacy_progress_payload(event: CoworkEvent) -> dict[str, Any] | None:
    status = str(event.payload.get("status") or "completed")
    label = str(event.payload.get("label") or event.payload.get("message") or event.type)
    base = {
        "type": "response.in_progress",
        "at_ms": event.at_ms,
        "cowork_event_type": event.type,
        "cowork_event_schema": event.schema_version,
        "thought_role": "thought.progress",
        "progress_status": status,
        "message": label,
        "content": str(event.payload.get("message") or label),
    }
    if event.type.startswith("tool."):
        return {
            **base,
            "phase": "tool",
            "tool_name": event.payload.get("tool_name") or label,
            "error": event.payload.get("error") or None,
        }
    if event.type == "artifact.created":
        artifact = event.payload.get("artifact") if isinstance(event.payload.get("artifact"), dict) else event.payload
        return {
            **base,
            "phase": "artifact",
            "message": label or f"Created artifact: {artifact.get('title') or artifact.get('name') or 'Artifact'}",
            "artifact": artifact,
        }
    if event.type == "reasoning":
        return {**base, "phase": event.payload.get("phase") or "reasoning"}
    if event.type == "file.accessed":
        return {
            **base,
            "phase": "file",
            "file_path": event.payload.get("path") or "",
            "tool_name": event.payload.get("tool_name") or "",
            "mode": event.payload.get("mode") or "",
        }
    if event.type == "source.used":
        return {
            **base,
            "phase": "source",
            "source_path": event.payload.get("source_path") or "",
            "tool_name": event.payload.get("tool_name") or "",
        }
    if event.type == "approval.required":
        return {
            **base,
            "phase": "approval",
            "progress_status": "started",
            "tool_name": event.payload.get("tool_name") or "",
            "approval_id": event.payload.get("approval_id") or "",
            "approval_status": event.payload.get("approval_status") or "pending",
            "resource": event.payload.get("resource") or None,
        }
    if event.type in {"approval.granted", "approval.denied", "approval.bypassed"}:
        failed = event.type == "approval.denied"
        return {
            **base,
            "phase": "approval",
            "progress_status": "failed" if failed else "completed",
            "tool_name": event.payload.get("tool_name") or "",
            "approval_id": event.payload.get("approval_id") or "",
            "approval_status": event.payload.get("approval_status") or ("denied" if failed else "approved"),
            "resource": event.payload.get("resource") or None,
        }
    if event.type == "access.denied":
        return {
            **base,
            "phase": "access",
            "progress_status": "failed",
            "resource": event.payload.get("resource") or None,
            "error": event.payload.get("message") or event.payload.get("error") or "Access denied",
        }
    if event.type == "artifact.ignored":
        return {
            **base,
            "phase": "artifact",
            "progress_status": "failed",
            "path": event.payload.get("path") or "",
            "error": event.payload.get("message") or "Artifact ignored",
        }
    return None


def cowork_event_to_legacy_sse(event: CoworkEvent) -> str:
    legacy = event.payload.get("legacy")
    if isinstance(legacy, dict):
        event_name = str(legacy.get("type") or event.type)
        payload = {
            **legacy,
            "cowork_event_type": event.type,
            "cowork_event_schema": event.schema_version,
        }
        return f"event: {event_name}\ndata: {json.dumps(payload)}\n\n"

    progress = _legacy_progress_payload(event)
    if progress is not None:
        return f"event: response.in_progress\ndata: {json.dumps(progress)}\n\n"

    if event.type == "message.delta":
        payload = {
            "type": "response.output_text.delta",
            "at_ms": event.at_ms,
            "cowork_event_type": event.type,
            "cowork_event_schema": event.schema_version,
            "delta": event.payload.get("delta") or "",
            **{k: v for k, v in event.payload.items() if k not in {"delta", "legacy", "legacy_type"}},
        }
        return f"event: response.output_text.delta\ndata: {json.dumps(payload)}\n\n"

    if event.type == "response.cancelled":
        payload = {
            "type": "response.failed",
            "at_ms": event.at_ms,
            "cowork_event_type": event.type,
            "cowork_event_schema": event.schema_version,
            "code": event.payload.get("code") or "cancelled",
            "error": event.payload.get("message") or "Response cancelled",
        }
        return f"event: response.failed\ndata: {json.dumps(payload)}\n\n"

    payload = {
        "type": event.type,
        "at_ms": event.at_ms,
        "cowork_event_type": event.type,
        "cowork_event_schema": event.schema_version,
        **event.payload,
    }
    return f"event: {event.type}\ndata: {json.dumps(payload)}\n\n"
