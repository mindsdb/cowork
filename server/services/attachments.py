"""Attachment business logic — text extraction, metadata, URL validation, context building.

Pure domain logic — raises ValueError for validation failures instead of HTTPException.
Routes catch these and map to HTTP 400/404 responses.
"""
from __future__ import annotations

import html
import ipaddress
import mimetypes
import re
import shutil
import socket
import subprocess
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

from routes.cowork_state import attachments_dir, load_state, save_state, utc_now_iso

TEXT_LIMIT = 120_000
ATTACHMENT_CONTEXT_LIMIT = 200_000
URL_READ_LIMIT = 1_000_000

TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".csv", ".json", ".jsonl",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss",
    ".html", ".htm", ".xml", ".yaml", ".yml", ".toml", ".log",
    ".sql", ".sh", ".zsh", ".rb", ".go", ".rs",
    ".java", ".c", ".cpp", ".h", ".hpp",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"}
SUPPORTED_ARCHIVE_EXTENSIONS = {".docx", ".xlsx", ".pptx"}


# ── Text extraction helpers ──────────────────────────────────────────────

def safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip()
    return cleaned[:140] or "attachment"


def new_id(prefix: str = "att") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def text_preview(text: str | None) -> str:
    if not text:
        return ""
    compact = re.sub(r"\s+", " ", text).strip()
    return compact[:320]


def truncate_text(text: str, limit: int = TEXT_LIMIT) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def decode_bytes(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _extract_text_file(path: Path) -> tuple[str, str, bool, str | None]:
    text = decode_bytes(path.read_bytes())
    text, truncated = truncate_text(text)
    return text, "ready", truncated, None


def _extract_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    parts = [node.text for node in root.iter() if node.tag.endswith("}t") and node.text]
    return "\n".join(parts)


def _extract_pptx(path: Path) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        for name in slide_names:
            root = ElementTree.fromstring(archive.read(name))
            slide_parts = [node.text for node in root.iter() if node.tag.endswith("}t") and node.text]
            if slide_parts:
                parts.append("\n".join(slide_parts))
    return "\n\n".join(parts)


def _extract_xlsx(path: Path) -> str:
    rows: list[str] = []
    shared: list[str] = []
    with zipfile.ZipFile(path) as archive:
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.iter():
                if item.tag.endswith("}si"):
                    text = "".join(node.text or "" for node in item.iter() if node.tag.endswith("}t"))
                    shared.append(text)
        sheet_names = sorted(name for name in archive.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
        for sheet_name in sheet_names:
            root = ElementTree.fromstring(archive.read(sheet_name))
            rows.append(f"## {Path(sheet_name).stem}")
            for row in root.iter():
                if not row.tag.endswith("}row"):
                    continue
                values: list[str] = []
                for cell in row:
                    if not cell.tag.endswith("}c"):
                        continue
                    cell_type = cell.attrib.get("t")
                    value_node = next((child for child in cell if child.tag.endswith("}v")), None)
                    inline_node = next((child for child in cell if child.tag.endswith("}is")), None)
                    value = ""
                    if value_node is not None and value_node.text:
                        value = value_node.text
                        if cell_type == "s":
                            try:
                                value = shared[int(value)]
                            except (ValueError, IndexError):
                                pass
                    elif inline_node is not None:
                        value = "".join(node.text or "" for node in inline_node.iter() if node.tag.endswith("}t"))
                    values.append(value)
                if values:
                    rows.append(",".join(values))
    return "\n".join(rows)


def _extract_pdf(path: Path) -> tuple[str, str, bool, str | None]:
    mdls = shutil.which("mdls")
    if mdls:
        try:
            result = subprocess.run(
                [mdls, "-raw", "-name", "kMDItemTextContent", str(path)],
                check=False, capture_output=True, text=True, timeout=10,
            )
            text = (result.stdout or "").strip()
            if text and text != "(null)":
                text, truncated = truncate_text(text)
                return text, "ready", truncated, None
        except (OSError, subprocess.SubprocessError):
            pass

    textutil = shutil.which("textutil")
    if textutil:
        try:
            result = subprocess.run(
                [textutil, "-convert", "txt", "-stdout", str(path)],
                check=False, capture_output=True, text=True, timeout=10,
            )
            text = (result.stdout or "").strip()
            if text:
                text, truncated = truncate_text(text)
                return text, "partial", truncated, "PDF text was extracted with the local text conversion tool."
        except (OSError, subprocess.SubprocessError):
            pass

    return "", "unsupported", False, "PDF text extraction is unavailable for this file in the local runtime."


def _image_info(path: Path) -> str | None:
    sips = shutil.which("sips")
    if not sips:
        return None
    try:
        result = subprocess.run(
            [sips, "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
            check=False, capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    width = re.search(r"pixelWidth:\s*(\d+)", result.stdout or "")
    height = re.search(r"pixelHeight:\s*(\d+)", result.stdout or "")
    if width and height:
        return f"{width.group(1)} x {height.group(1)} px"
    return None


def extract_attachment_text(path: Path, mime: str | None = None) -> tuple[str, str, bool, str | None]:
    ext = path.suffix.lower()
    try:
        if ext in TEXT_EXTENSIONS or (mime and mime.startswith("text/")):
            return _extract_text_file(path)
        if ext == ".docx":
            text, truncated = truncate_text(_extract_docx(path))
            return text, "ready", truncated, None
        if ext == ".pptx":
            text, truncated = truncate_text(_extract_pptx(path))
            return text, "ready", truncated, None
        if ext == ".xlsx":
            text, truncated = truncate_text(_extract_xlsx(path))
            return text, "ready", truncated, None
        if ext == ".pdf":
            return _extract_pdf(path)
        if ext in IMAGE_EXTENSIONS or (mime and mime.startswith("image/")):
            info = _image_info(path)
            note = "Image preview is available; OCR/vision extraction is not available in this local runtime."
            if info:
                note = f"{note} Image dimensions: {info}."
            return "", "preview_only", False, note
    except (OSError, KeyError, zipfile.BadZipFile, ElementTree.ParseError, UnicodeDecodeError) as exc:
        return "", "error", False, f"Could not extract text from this attachment: {exc}"
    return "", "unsupported", False, "This file type can be attached, but text extraction is not supported yet."


# ── Metadata store ───────────────────────────────────────────────────────

def store_metadata(metadata: dict) -> dict:
    state = load_state()
    state["attachments"][metadata["id"]] = metadata
    save_state(state)
    return metadata


def make_attachment(
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
    attachment_id = new_id()
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
        "textPreview": text_preview(text),
        "truncated": truncated,
        "note": note,
    }
    return store_metadata(metadata)


def get_attachments(ids: list[str] | None = None) -> list[dict]:
    state = load_state()
    attachments = state.get("attachments", {})
    if ids is None:
        return sorted(attachments.values(), key=lambda item: item.get("createdAt", ""), reverse=True)
    return [attachments[item_id] for item_id in ids if item_id in attachments]


def assign_attachments(ids: list[str] | None, session_id: str) -> list[dict]:
    if not ids:
        return []
    state = load_state()
    updated: list[dict] = []
    for item_id in ids:
        metadata = state.get("attachments", {}).get(item_id)
        if not metadata:
            continue
        metadata["sessionId"] = session_id
        metadata["updatedAt"] = utc_now_iso()
        updated.append(metadata)
    save_state(state)
    return updated


def delete_attachment_by_id(attachment_id: str) -> dict | None:
    """Returns the removed metadata, or None if not found."""
    state = load_state()
    metadata = state.get("attachments", {}).pop(attachment_id, None)
    if not metadata:
        return None
    save_state(state)
    path = metadata.get("path")
    if path:
        parent = Path(path).parent
        if parent.name == attachment_id:
            shutil.rmtree(parent, ignore_errors=True)
    return metadata


# ── Attachment context builder ───────────────────────────────────────────

def attachment_context(ids: list[str] | None) -> str:
    selected = get_attachments(ids or [])
    if not selected:
        return ""
    remaining = ATTACHMENT_CONTEXT_LIMIT
    sections = ["Attached context supplied by the user:"]
    for item in selected:
        header_bits = [item.get("kind") or "attachment", item.get("mime") or "unknown type"]
        if item.get("sourceUrl"):
            header_bits.append(item["sourceUrl"])
        elif item.get("source"):
            header_bits.append(item["source"])
        header = f"### {item.get('name') or item['id']} ({'; '.join(header_bits)})"
        text = item.get("text") or ""
        note = item.get("note")
        if not text:
            text = f"[No extracted text. Extraction status: {item.get('extractionStatus', 'unknown')}.]"
            if note:
                text += f" {note}"
        chunk = text[: max(0, min(len(text), remaining))]
        if item.get("truncated") or len(text) > len(chunk):
            chunk += "\n[Attachment text was truncated before being sent to Anton.]"
        sections.append(f"{header}\n```text\n{chunk}\n```")
        remaining -= len(chunk)
        if remaining <= 0:
            sections.append("[Additional attachment context was omitted because the combined context was too large.]")
            break
    return "\n\n".join(sections)


# ── URL fetching + SSRF validation ──────────────────────────────────────

class UrlValidationError(ValueError):
    """Raised when a URL fails SSRF or format validation."""


def validate_url_target(url: str) -> str:
    """Raises UrlValidationError on failure, returns url on success."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise UrlValidationError("Only http and https URLs can be attached.")
    if not parsed.hostname:
        raise UrlValidationError("URL must include a hostname.")
    hostname = parsed.hostname.strip().lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
        raise UrlValidationError("Local and private URLs cannot be attached.")
    try:
        addresses = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UrlValidationError(f"Could not resolve URL hostname: {exc}") from exc
    for info in addresses:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            raise UrlValidationError("URL resolved to an invalid address.")
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise UrlValidationError("Local and private URLs cannot be attached.")
        if str(ip) == "169.254.169.254":
            raise UrlValidationError("Metadata service URLs cannot be attached.")
    return url


class _SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url_target(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_url_text(url: str) -> tuple[str, str, str | None]:
    """Returns (text, final_url, title). Raises UrlValidationError on SSRF."""
    safe_url = validate_url_target(url)
    request = Request(safe_url, headers={"User-Agent": "Anton-CoWork/1.0"})
    opener = build_opener(_SafeRedirectHandler)
    try:
        with opener.open(request, timeout=12) as response:
            final_url = response.geturl()
            validate_url_target(final_url)
            content_type = response.headers.get("content-type", "")
            data = response.read(URL_READ_LIMIT + 1)
    except UrlValidationError:
        raise
    except Exception as exc:
        raise UrlValidationError(f"Could not fetch URL: {exc}") from exc
    truncated = len(data) > URL_READ_LIMIT
    data = data[:URL_READ_LIMIT]
    text = decode_bytes(data)
    title = None
    if "html" in content_type.lower() or re.search(r"<html|<body|<title", text, re.I):
        title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        if title_match:
            title = html.unescape(re.sub(r"\s+", " ", title_match.group(1))).strip()
        text = re.sub(r"(?is)<script.*?</script>|<style.*?</style>|<noscript.*?</noscript>", " ", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = html.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()
    if truncated:
        text += "\n\n[URL content was truncated before being stored.]"
    return text, final_url, title


# ── Project file listing ─────────────────────────────────────────────────

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".anton"}


def list_project_files(project_path: str, query: str | None = None, limit: int = 50) -> list[dict]:
    root = Path(project_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError("Project path does not exist.")
    q = (query or "").lower().strip()
    results: list[dict] = []
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if not path.is_file():
            continue
        rel = str(path.relative_to(root))
        if q and q not in rel.lower():
            continue
        if path.stat().st_size > 8_000_000:
            continue
        ext = path.suffix.lower()
        supported = ext in TEXT_EXTENSIONS or ext in SUPPORTED_ARCHIVE_EXTENSIONS or ext == ".pdf" or ext in IMAGE_EXTENSIONS
        results.append({"path": rel, "name": path.name, "size": path.stat().st_size, "supported": supported})
        if len(results) >= limit:
            break
    return results
