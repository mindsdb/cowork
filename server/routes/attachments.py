"""Attachment and URL context APIs for Anton CoWork."""

from __future__ import annotations

import datetime
import mimetypes
import re
import shutil
from typing import Union
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from .cowork_state import load_state, save_state, uploads_dir, utc_now_iso
from anton_api.projects_store import resolve_project


router = APIRouter(prefix="/v1/attachments", tags=["attachments"])

TEXT_LIMIT = 120_000


class SnippetAttachmentRequest(BaseModel):
    title: str = Field(default="Snippet", max_length=160)
    content: str
    language: str | None = Field(default=None, max_length=40)
    session_id: str | None = None
    project_path: str | None = None


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


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip()
    return cleaned[:140] or "attachment"


def _new_id(prefix: str = "att") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _text_preview(text: str | None) -> str:
    if not text:
        return ""
    compact = re.sub(r"\s+", " ", text).strip()
    return compact[:320]


def _truncate_text(text: str, limit: int = TEXT_LIMIT) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def _store_metadata(metadata: dict) -> dict:
    state = load_state()
    state["attachments"][metadata["id"]] = metadata
    save_state(state)
    return metadata


def _make_attachment(
    *,
    kind: str,
    name: str,
    source: str,
    path: str | None = None,
    source_url: str | None = None,
    session_id: str | None = None,
    project_path: str | None = None,
    mime: str | None = None,
    size: int | None = None,
    text: str = "",
    extraction_status: str = "ready",
    truncated: bool = False,
    note: str | None = None,
    language: str | None = None,
) -> dict:
    attachment_id = _new_id()
    now = utc_now_iso()
    metadata = {
        "id": attachment_id,
        "kind": kind,
        "name": name,
        "mime": mime or mimetypes.guess_type(name)[0] or "application/octet-stream",
        "size": size or 0,
        "path": path,
        "source": source,
        "sourceUrl": source_url,
        "sessionId": session_id,
        "projectPath": project_path,
        "language": language,
        "createdAt": now,
        "updatedAt": now,
        "status": "ready" if extraction_status != "error" else "error",
        "extractionStatus": extraction_status,
        "text": text,
        "textPreview": _text_preview(text),
        "truncated": truncated,
        "note": note,
    }
    return _store_metadata(metadata)


def get_attachments(
    project_name: str | None = None,
    session_id: str | None = None,
    ids: list[str] | None = None
) -> list[FileAttachment]:
    _, project_path = resolve_project(project_name)
    project_uploads_dir = uploads_dir(project_path)
    if session_id:
        project_uploads_dir = project_uploads_dir / session_id

    if ids is None:
        files = sorted(project_uploads_dir.iterdir(), key=lambda item: item.stat().st_ctime, reverse=True)
    files = [project_uploads_dir / item_id for item_id in ids if (project_uploads_dir / item_id).exists()]
    return [FileAttachment.from_path(file.name, file) for file in files]


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


@router.get("")
def list_attachments(
    project_name: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
    ids: list[str] | None = Query(default=None),
):
    return get_attachments(project_name, session_id, ids)


@router.post("/upload")
async def upload_attachments(
    project_name: str | None = Form(default=None),
    session_id: str | None = Form(default=None),
    files: list[UploadFile] = File(...),
) -> list[FileAttachment]:
    # Store uploads in the project's /uploads directory.
    _, project_path = resolve_project(project_name)
    project_uploads_dir = uploads_dir(project_path)

    created: list[dict] = []
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
    return {"attachments": created}


@router.post("/snippet")
def create_snippet(request: SnippetAttachmentRequest):
    text, truncated = _truncate_text(request.content)
    metadata = _make_attachment(
        kind="snippet",
        name=request.title or "Snippet",
        source="snippet",
        session_id=request.session_id,
        project_path=request.project_path,
        mime="text/plain",
        size=len(request.content.encode("utf-8")),
        text=text,
        extraction_status="ready",
        truncated=truncated,
        language=request.language,
    )
    return {"attachment": metadata}


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
