"""Cowork-owned artifact event collection around harness turns."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .access import event_for_artifact_ignored
from .artifacts import scan_ignored_artifacts, scan_updated_artifacts, snapshot_artifacts
from .schemas import CoworkEvent


def artifact_key(artifact: dict[str, Any]) -> str:
    raw = artifact.get("folder") or artifact.get("path") or artifact.get("file_path")
    if raw:
        try:
            return str(Path(str(raw)).resolve(strict=False))
        except Exception:
            return str(raw)
    return str(artifact.get("id") or "")


def artifact_created_event(turn_id: str, artifact: dict[str, Any]) -> CoworkEvent:
    title = str(artifact.get("title") or artifact.get("name") or "Artifact")
    legacy = {
        "type": "response.in_progress",
        "thought_role": "thought.progress",
        "phase": "artifact",
        "progress_status": "completed",
        "message": f"Created artifact: {title}",
        "content": title,
        "artifact": artifact,
    }
    return CoworkEvent(
        type="artifact.created",
        turn_id=turn_id,
        payload={
            "legacy": legacy,
            "legacy_type": "response.in_progress",
            "label": title,
            "status": "completed",
            "artifact": artifact,
        },
    )


class TurnArtifactCollector:
    """Tracks valid/invalid artifact changes for one Cowork turn.

    Harnesses may emit their own `artifact.created` hints, but Cowork owns
    registration and validation. This collector dedupes adapter hints against
    the final filesystem scan under the project artifact root.
    """

    def __init__(self, artifact_root: str | Path):
        self.artifact_root = Path(artifact_root)
        self.before = snapshot_artifacts(self.artifact_root)
        self.emitted: set[str] = set()

    def note_event(self, event: CoworkEvent) -> None:
        if event.type != "artifact.created":
            return
        artifact = event.payload.get("artifact")
        if isinstance(artifact, dict):
            key = artifact_key(artifact)
            if key:
                self.emitted.add(key)

    def collect(self, turn_id: str) -> list[CoworkEvent]:
        events: list[CoworkEvent] = []
        for artifact in scan_updated_artifacts(self.artifact_root, self.before):
            key = artifact_key(artifact)
            if key and key in self.emitted:
                continue
            if key:
                self.emitted.add(key)
            events.append(artifact_created_event(turn_id, artifact))
        for ignored in scan_ignored_artifacts(self.artifact_root, self.before):
            key = str(ignored.get("path") or "")
            if key and key in self.emitted:
                continue
            if key:
                self.emitted.add(key)
            events.append(event_for_artifact_ignored(
                turn_id,
                key,
                str(ignored.get("reason") or "Artifact metadata is invalid"),
            ))
        return events
