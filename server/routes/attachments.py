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
from fastapi.responses import FileResponse
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


def _attachment_dir(project_name: str, session_id: str, attachment_id: str) -> Path:
    """Resolve `<project>/.anton/uploads/<session_id>/<attachment_id>/`.

    Bounds-checks `attachment_id` so a caller can't path-traverse into a
    different project's uploads. Raises 404 if the directory doesn't
    exist (caller hasn't created it yet), 400 if the id looks tampered.
    """
    if "/" in attachment_id or attachment_id.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid attachment id")
    _, project_path = resolve_project(project_name)
    target_dir = uploads_dir(project_path) / session_id / attachment_id
    try:
        target_dir.resolve().relative_to(uploads_dir(project_path).resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid attachment path") from exc
    if not target_dir.is_dir():
        raise HTTPException(status_code=404, detail="Attachment not found")
    return target_dir


@router.delete("/{project_name}/{session_id}/{attachment_id}")
def delete_attachment_by_path(project_name: str, session_id: str, attachment_id: str):
    """Remove the attachment dir from disk.

    The legacy `DELETE /v1/attachments/{id}` route below looks up state
    in a JSON sidecar that the upload code never populates, so it
    always 404s — keeping it for back-compat but the renderer now
    calls this path-scoped variant instead. Reuses `_attachment_dir`
    for the path-traversal guard.
    """
    target_dir = _attachment_dir(project_name, session_id, attachment_id)
    shutil.rmtree(target_dir, ignore_errors=True)
    return {"ok": True}


@router.get("/{project_name}/{session_id}/{attachment_id}/raw")
def download_attachment(project_name: str, session_id: str, attachment_id: str):
    """Stream the underlying attachment bytes inline so a browser tab
    can render images/PDFs directly. Mirrors `projects.download_project_file`
    but uses `Content-Disposition: inline` rather than `attachment` —
    the UI uses this for "open in browser" semantics on a task upload
    row click, where forcing a download would be surprising.
    """
    target_dir = _attachment_dir(project_name, session_id, attachment_id)
    leaf = _file_inside_attachment_dir(target_dir)
    if leaf is None or not leaf.is_file():
        raise HTTPException(status_code=404, detail="Attachment file missing")
    media_type = mimetypes.guess_type(str(leaf))[0] or "application/octet-stream"
    return FileResponse(
        leaf,
        media_type=media_type,
        filename=leaf.name,
        headers={"Content-Disposition": f'inline; filename="{leaf.name}"'},
    )


@router.post("/{project_name}/{session_id}/{attachment_id}/move-to-project")
def move_attachment_to_project(project_name: str, session_id: str, attachment_id: str):
    """Promote a task upload into a project-level file.

    The on-disk file moves from
        <project>/.anton/uploads/<session_id>/<attachment_id>/<filename>
    to
        <project>/<filename>
    so it becomes part of the project working folder (visible in the
    Files rail, mounted by future tasks, etc.). If the destination
    already exists, a numeric suffix is appended (e.g. `report (2).pdf`)
    rather than overwriting silently. Returns the new project-relative
    path so the client can refresh both lists.
    """
    target_dir = _attachment_dir(project_name, session_id, attachment_id)
    leaf = _file_inside_attachment_dir(target_dir)
    if leaf is None or not leaf.is_file():
        raise HTTPException(status_code=404, detail="Attachment file missing")

    _, project_path = resolve_project(project_name)
    project_root = project_path.resolve()
    # Collision-safe destination: `<stem> (N)<suffix>` until we find a
    # free slot. Caps at 99 retries to avoid pathological loops on a
    # filesystem that errors on stat.
    dest = project_root / leaf.name
    if dest.exists():
        stem = leaf.stem
        suffix = leaf.suffix
        for i in range(2, 100):
            candidate = project_root / f"{stem} ({i}){suffix}"
            if not candidate.exists():
                dest = candidate
                break
        else:
            raise HTTPException(status_code=409, detail="Could not pick a unique filename")

    try:
        shutil.move(str(leaf), str(dest))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Move failed: {exc}") from exc
    # The attachment dir is now empty (it only ever held one leaf file
    # — see `_file_inside_attachment_dir`). Clean it up so the
    # attachments list doesn't surface a phantom entry.
    shutil.rmtree(target_dir, ignore_errors=True)

    return {
        "ok": True,
        "project_path": dest.name,
        "absolute_path": str(dest),
    }
