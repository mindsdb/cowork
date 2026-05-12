"""Attachment and URL context APIs for Anton CoWork."""

from __future__ import annotations

import datetime
import mimetypes
import re
import shutil
from typing import Union
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from .cowork_state import load_state, save_state, utc_now_iso
from anton_api.projects_store import resolve_project


router = APIRouter(prefix="/v1/attachments", tags=["attachments"])

TEXT_LIMIT = 120_000


class FileAttachment(BaseModel):
    id: str
    name: str
    mime: str
    size: int
    path: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    @classmethod
    def from_path(cls, file_id: str, file_path: Union[str, Path]):
        # Path() will accept a string or an existing Path object
        path_obj = Path(file_path)
        
        if not path_obj.exists():
            raise FileNotFoundError(f"File not found at: {path_obj}")

        stats = path_obj.stat()
        mime_type, _ = mimetypes.guess_type(path_obj)
        
        return cls(
            id=file_id,
            name=path_obj.name,
            mime=mime_type or "application/octet-stream",
            size=stats.st_size,
            path=str(path_obj.absolute()),
            created_at=datetime.datetime.fromtimestamp(stats.st_ctime),
            updated_at=datetime.datetime.fromtimestamp(stats.st_mtime)
        )


def uploads_dir(project_path: Path) -> Path:
    path = project_path / ".anton" / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    try:
        path.chmod(0o700)
    except OSError:
        pass
    return path


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip()
    return cleaned[:140] or "attachment"


def _new_id(prefix: str = "att") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _file_inside_attachment_dir(attachment_dir: Path) -> Path | None:
    """Return the on-disk file stored under ``…/<attachment_id>/`` (upload writes one file per folder)."""
    if not attachment_dir.is_dir():
        return None
    candidates = [
        p for p in attachment_dir.iterdir()
        if p.is_file() and not p.name.startswith(".")
    ]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    return max(candidates, key=lambda p: p.stat().st_mtime)


def get_attachments(
    project_name: str | None = None,
    session_id: str | None = None,
    ids: list[str] | None = None
) -> list[FileAttachment]:
    _, project_path = resolve_project(project_name)
    project_uploads_dir = uploads_dir(project_path)
    if session_id:
        project_uploads_dir = project_uploads_dir / session_id

    if not project_uploads_dir.is_dir():
        return []

    files: list[FileAttachment] = []
    try:
        for item in project_uploads_dir.iterdir():
            if not item.is_dir():
                continue
            leaf = _file_inside_attachment_dir(item)
            if leaf is None:
                continue
            try:
                files.append(FileAttachment.from_path(item.name, leaf))
            except (FileNotFoundError, OSError):
                continue
    except OSError:
        return []

    if ids:
        id_set = set(ids)
        files = [f for f in files if f.id in id_set]
    return sorted(files, key=lambda x: x.updated_at, reverse=True)


def attachment_context(project_name: str | None, session_id: str | None, ids: list[str] | None) -> str:
    selected = get_attachments(project_name, session_id, ids)
    if not selected:
        return ""

    sections = ["Attached context supplied by the user:"]
    for item in selected:
        header = f"### {item.name} ({item.mime})"
        sections.append(header)
        path = f"File path: {item.path}"
        sections.append(path)

    return "\n\n".join(sections)


@router.get("/{project_name}/{session_id}")
def list_attachments(
    project_name: str,
    session_id: str,
    ids: list[str] | None = Query(default=None),
):
    return get_attachments(project_name, session_id, ids)


@router.post("/{project_name}/{session_id}/upload")
async def upload_attachments(
    project_name: str,
    session_id: str,
    files: list[UploadFile] = File(...),
) -> list[FileAttachment]:
    # Store uploads in the project's /uploads directory.
    _, project_path = resolve_project(project_name)
    project_uploads_dir = uploads_dir(project_path)

    created: list[FileAttachment] = []
    for file in files:
        attachment_id = _new_id()
        filename = _safe_name(file.filename or "attachment")
        target_dir = project_uploads_dir / session_id / attachment_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / filename
        data = await file.read()
        target.write_bytes(data)

        attachment = FileAttachment.from_path(attachment_id, target)
        created.append(attachment)
    return created


@router.delete("/{attachment_id}")
def delete_attachment(attachment_id: str):
    state = load_state()
    metadata = state.get("attachments", {}).pop(attachment_id, None)
    if not metadata:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    save_state(state)
    path = metadata.get("path")
    if path:
        parent = Path(path).parent
        if parent.name == attachment_id:
            shutil.rmtree(parent, ignore_errors=True)
    return {"ok": True}
