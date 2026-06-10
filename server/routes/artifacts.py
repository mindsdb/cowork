"""
Artifacts — outputs Anton produces, surfaced to the user.

Each artifact is a folder under `<project>/.anton/artifacts/<slug>/`. The
folder owns its `metadata.json` (Pydantic-validated source of truth)
and `README.md` (rendered from metadata). Multi-file outputs (HTML +
CSS + JS, app + dataset) cluster together; single-file outputs
(document, image) live in their own folder anyway so provenance can
attach.

This module:
  - Lists every artifact across registered projects, newest first.
  - Resolves a request path (relative slug-anchored or absolute) to
    a real file on disk for opening / previewing.
  - Mounts an HTML artifact's parent dir as a token-keyed asset URL
    so the in-app iframe preview can resolve relative `<script>` /
    `<link>` references the same way a browser would.
"""
from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterator
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from anton_api import projects_store
from .app_server_manager import start as _start_app_server, stop as _stop_app_server, get_port as _get_app_port

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory registry mapping a short, deterministic token to the parent
# directory of an HTML artifact's primary file. Used by the in-app
# iframe preview so relative `<script src=…>` / `<link href=…>`
# references can resolve against a real URL (srcdoc has no base URL
# → relative refs 404). Token is sha256(parent_dir)[:16] — stable
# across calls so reopens don't allocate fresh entries.
_PREVIEW_MOUNTS: dict[str, Path] = {}


# ─── Type / kind mapping ───────────────────────────────────────────────────
#
# Stored `type` values (from `Artifact.type`) map onto display kinds
# used by the renderer's card chrome. Kept in sync with the closed
# enum in anton-core's `core/artifacts/models.py`.

ARTIFACT_TYPES = {
    "html-app",
    "document",
    "dataset",
    "image",
    "mixed",
    "fullstack-stateless-app",
    "fullstack-stateful-app",
}

KIND_BY_TYPE = {
    "html-app": "Dashboard",
    "document": "Document",
    "dataset": "Data",
    "image": "Image",
    "mixed": "Bundle",
    "fullstack-stateless-app": "App",
    "fullstack-stateful-app": "App",
}

# Fallback kind by extension when an artifact has no metadata yet
# (shouldn't happen with the new flow, but tolerated for resilience).
KIND_BY_EXT = {
    ".html": "Dashboard",
    ".md": "Document",
    ".txt": "Document",
    ".pdf": "Document",
    ".csv": "Data",
    ".json": "Data",
    ".png": "Image",
    ".jpg": "Image",
    ".jpeg": "Image",
    ".svg": "Image",
}

BG_CYCLE = [
    "linear-gradient(135deg, var(--stone-100), var(--surface-03))",
    "linear-gradient(135deg, var(--ocean-50), #fff)",
    "linear-gradient(135deg, var(--sage-50), #fff)",
    "linear-gradient(135deg, #fff, var(--stone-150))",
]

# Upper bound on a raw artifact-path string. Generous (Linux PATH_MAX is
# 4096); real artifact paths are far shorter. Rejects pathological input
# before it ever reaches the filesystem.
_MAX_ARTIFACT_PATH_LEN = 4096

# Files under each artifact folder that are housekeeping rather than
# user-content. They're listed in metadata for the renderer but not
# considered when picking the "primary" file to open.
_HOUSEKEEPING_FILES = {"metadata.json", "README.md", ".published.json"}

# Extensions we'll preview as text in the artifact viewer.
TEXT_EXTENSIONS = {
    ".html", ".md", ".txt", ".csv", ".json", ".py", ".js",
    ".ts", ".tsx", ".css", ".log",
}


# ─── Helpers ───────────────────────────────────────────────────────────────


def _human_mtime(path: Path) -> str:
    secs = time.time() - path.stat().st_mtime
    if secs < 60:    return "updated just now"
    if secs < 3600:  return f"updated {int(secs // 60)}m ago"
    if secs < 86400: return f"updated {int(secs // 3600)}h ago"
    return f"updated {int(secs // 86400)}d ago"


def _registered_project_dirs() -> list[Path]:
    """Resolved project directories that are provably inside the projects root.

    Two-step gate so callers can treat the result as a trusted
    allowlist:
      1. Read `projects_store.list_projects()` — server-managed, but
         entries could in principle be symlinks or stale.
      2. Re-resolve each entry and require it to live under the
         canonical `projects_store.projects_dir()`. Anything that
         escapes the root via symlink, `..`, or out-of-band
         tampering is dropped silently.

    This is the sanitizer for every code path in this module that
    needs to turn an untrusted-or-untrustworthy path string into a
    real filesystem location — both `_scan_artifact_dirs` and the
    `project_path` query-param branch in `_iter_artifact_folders`
    rely on it. CodeQL `py/path-injection` recognises the
    `resolve()` + `relative_to(root)` pair as a sanitizer.
    """
    try:
        root = projects_store.projects_dir().resolve(strict=False)
    except OSError:
        return []
    out: list[Path] = []
    for project in projects_store.list_projects():
        try:
            candidate = Path(project["path"]).resolve(strict=False)
            candidate.relative_to(root)
        except (ValueError, OSError, KeyError):
            continue
        out.append(candidate)
    return out


def _scan_artifact_dirs() -> list[Path]:
    """Every registered project's `<base>/.anton/artifacts/` dir that exists.

    Project paths are funnelled through `_registered_project_dirs`
    so a tampered projects-store entry (symlink pointing outside
    the projects root, hand-edited path) can't leak an artifact
    root that escapes the allowlisted projects directory.

    The legacy `.anton/output/` flat dump is intentionally NOT
    scanned anymore — the renamed model demands per-folder metadata
    and old files have neither. Users migrate by moving their files
    into a proper `.anton/artifacts/<slug>/` subfolder; until they do, the
    files just stay where they are and stop showing up here.
    """
    dirs: dict[str, Path] = {}
    for project_dir in _registered_project_dirs():
        candidate = project_dir / ".anton" / "artifacts"
        if candidate.is_dir():
            dirs[str(candidate.resolve())] = candidate
    return list(dirs.values())


def _allowed_artifact_dir_index() -> dict[str, Path]:
    """Server-built allowlist of artifact folders.

    Keys are string forms the UI may send back to the API.
    Values are canonical, resolved artifact folder paths.

    Important security property:
    user input is never converted into a Path here. We only compare
    user input as a plain string against paths discovered from trusted
    registered project artifact roots.
    """
    allowed: dict[str, Path] = {}

    for root in _scan_artifact_dirs():
        try:
            resolved_root = root.resolve(strict=True)
        except OSError:
            continue

        try:
            for child in resolved_root.iterdir():
                try:
                    if child.is_symlink() or not child.is_dir():
                        continue

                    resolved_child = child.resolve(strict=True)
                    resolved_child.relative_to(resolved_root)
                except (OSError, ValueError):
                    continue

                allowed[str(resolved_child)] = resolved_child
                allowed[resolved_child.as_posix()] = resolved_child

                allowed[str(child)] = resolved_child
                allowed[child.as_posix()] = resolved_child

        except OSError:
            continue

    return allowed


def _safe_artifact_dir(raw_path: str) -> Path:
    """Return a trusted artifact folder from a user-supplied path string.

    The request value is treated only as an opaque string. It is never
    expanded, resolved, joined, or opened. The only accepted values are
    exact string matches for artifact folders discovered under registered
    project `.anton/artifacts/` directories.
    """
    if not isinstance(raw_path, str) or not raw_path or "\x00" in raw_path:
        raise HTTPException(status_code=400, detail="Invalid artifact path")

    text = raw_path.strip()
    if not text or text != raw_path:
        raise HTTPException(status_code=400, detail="Invalid artifact path")

    folder = _allowed_artifact_dir_index().get(text)
    if folder is None:
        raise HTTPException(status_code=404, detail="Artifact folder not found")

    return folder


def _iter_artifact_folders(project_path: str | None = None) -> Iterator[Path]:
    """Yield every direct subfolder of every project's .anton/artifacts/ dir.

    Only folders containing a readable `metadata.json` are passed
    through to callers; bare folders are skipped (incomplete writes,
    or user-stashed dirs the agent hasn't claimed).

    When `project_path` is provided, restrict the walk to that single
    project's `<base>/.anton/artifacts/`. The argument arrives from
    an unauthenticated query parameter, so it's treated as untrusted:
    it must resolve to one of the directories in
    `_registered_project_dirs()` (allowlist match against the canonical
    projects root). Anything else — empty string, null byte, paths
    outside the projects dir, paths the user hand-typed in DevTools —
    is dropped without touching the filesystem beyond the resolve.
    """
    roots: list[Path]
    if project_path is not None:
        if not project_path or "\x00" in project_path:
            return
        try:
            requested = Path(project_path).expanduser().resolve(strict=False)
        except (OSError, ValueError, RuntimeError):
            return
        registered = {p for p in _registered_project_dirs()}
        if requested not in registered:
            return
        candidate = requested / ".anton" / "artifacts"
        if not candidate.is_dir():
            return
        roots = [candidate]
    else:
        roots = _scan_artifact_dirs()
    for root in roots:
        try:
            for child in sorted(root.iterdir()):
                if not child.is_dir():
                    continue
                if not (child / "metadata.json").is_file():
                    continue
                yield child
        except OSError:
            continue


def _load_metadata(folder: Path) -> dict | None:
    path = folder / "metadata.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("Skipping artifact with unreadable metadata: %s", path, exc_info=True)
        return None


def _user_files(folder: Path) -> list[Path]:
    """All non-housekeeping files inside an artifact folder.

    Walks recursively (so `data/prices.csv` shows up alongside
    `dashboard.html`). Sorted by mtime descending so the "primary"
    pick lands on whatever was written most recently.
    """
    out: list[Path] = []
    try:
        for p in folder.rglob("*"):
            if not p.is_file() or p.is_symlink():
                continue
            rel = p.relative_to(folder)
            top = rel.parts[0] if rel.parts else ""
            if top in _HOUSEKEEPING_FILES:
                continue
            out.append(p)
    except OSError:
        return []
    try:
        out.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        pass
    return out


def _pick_primary(folder: Path, files: list[Path], primary_hint: str | None = None) -> Path | None:
    """The "open this" file for an artifact card.

    Resolution order:
      0. `metadata.primary` (when set and the file exists) — the
         agent declared this explicitly at create_artifact time, so
         it wins over the heuristic.
      1. `index.html` if present — the universal app entry point.
      2. The newest `.html` file — dashboards, reports.
      3. The newest non-housekeeping file of any type — covers
         documents, datasets, images, bundles.
    Returns None when the folder has no user-content yet (artifact
    just claimed, no writes), or when the agent's declared primary
    points at a missing file AND no fallback exists.
    """
    # Honor the agent's declared primary when the file actually
    # exists. Path-traversal guard: must resolve inside `folder`.
    if primary_hint:
        try:
            target = (folder / primary_hint).resolve()
            target.relative_to(folder.resolve())
            if target.is_file():
                return target
        except (ValueError, OSError):
            pass
    if not files:
        return None
    index = next((f for f in files if f.name == "index.html"), None)
    if index is not None:
        return index
    html = next((f for f in files if f.suffix.lower() == ".html"), None)
    if html is not None:
        return html
    return files[0]


def _published_url_for(folder: Path, primary: Path | None) -> str:
    """Look up the published URL recorded for this artifact, if any.

    The publisher writes a `.published.json` map keyed by file name
    inside the artifact folder. We surface only the URL for the
    primary file so the card shows a single Published pill instead
    of one per file.
    """
    if primary is None:
        return ""
    published_index = folder / ".published.json"
    if not published_index.is_file():
        return ""
    try:
        pmap = json.loads(published_index.read_text(encoding="utf-8"))
        entry = pmap.get(primary.name)
        if isinstance(entry, dict):
            return entry.get("url", "") or ""
    except Exception:
        pass
    return ""


def _published_access_for(folder: Path, primary: Path | None) -> dict:
    """Owner-side access state for the primary file, from `.published.json`.

    Returns {"accessProtected": bool, "accessPassword": str}. The plaintext
    password is owner-only — `.published.json` never enters the published
    bundle — and powers the in-app eye-reveal. Callers must only return
    this to the artifact's owner (the local/authenticated session).
    """
    out = {"accessProtected": False, "accessPassword": ""}
    if primary is None:
        return out
    published_index = folder / ".published.json"
    if not published_index.is_file():
        return out
    try:
        pmap = json.loads(published_index.read_text(encoding="utf-8"))
        entry = pmap.get(primary.name)
        if isinstance(entry, dict) and entry.get("requires_password"):
            out["accessProtected"] = True
            out["accessPassword"] = entry.get("access_password", "") or ""
    except Exception:
        pass
    return out


# ─── Stable HTTP serving ─────────────────────────────────────────────────
#
# Origin-relative URLs that serve an artifact's files straight off disk:
#
#   GET /v1/artifacts/serve/<project_name>/<rel_path_under_.anton/artifacts>
#
# Unlike the token-keyed `preview-asset` flow, this is STATELESS — the
# project + path are resolved at request time, so there's nothing to
# register, nothing to keep in sync as projects come and go, and the
# URL is stable + shareable. Origin-relative means it resolves against
# whatever host the browser is on: 127.0.0.1:26866 in the desktop
# shell, the public origin in the web deployment. No 127.0.0.1 ever
# leaks into a URL.
#
# Access control is handled entirely by the auth proxy in front of the
# deployment (it gates every endpoint, this one included), so the route
# carries no auth logic — same trust model as the rest of /v1/*. The
# only thing it enforces is that you can't escape a registered
# project's artifacts tree (project allowlist + path-traversal guard).


def _project_artifacts_base(project_name: str) -> Path | None:
    """Resolve a project NAME to its `<base>/.anton/artifacts` dir, but
    only when it maps to a registered project (allowlist). Returns None
    for unknown projects or anything that looks like a path-traversal
    attempt in the name itself."""
    if (not project_name or "\x00" in project_name
            or "/" in project_name or "\\" in project_name
            or project_name in (".", "..")):
        return None
    registered = {p for p in _registered_project_dirs()}
    try:
        candidate = projects_store.project_path(project_name).resolve(strict=False)
    except (OSError, ValueError):
        return None
    if candidate not in registered:
        return None
    base = candidate / ".anton" / "artifacts"
    return base if base.is_dir() else None


def _serve_url_for(path: str | Path) -> str:
    """Origin-relative `/v1/artifacts/serve/...` URL for a file that
    lives under some registered project's `.anton/artifacts` tree.
    Returns "" when the path isn't inside such a tree (e.g. an artifact
    whose folder has no primary file yet, so `path` is the folder)."""
    try:
        p = Path(path).resolve(strict=False)
    except (OSError, ValueError):
        return ""
    for project_dir in _registered_project_dirs():
        base = (project_dir / ".anton" / "artifacts")
        try:
            rel = p.relative_to(base.resolve())
        except (ValueError, OSError):
            continue
        if not rel.parts:
            return ""  # the path IS the artifacts dir, not a file under it
        rel_str = "/".join(quote(part) for part in rel.parts)
        return f"/v1/artifacts/serve/{quote(project_dir.name)}/{rel_str}"
    return ""


@router.get("/serve/{project_name}/{file_path:path}")
def serve_artifact(project_name: str, file_path: str):
    """Serve a file from `<project>/.anton/artifacts/<file_path>` over
    HTTP. Stateless, origin-relative, frame-able (no X-Frame-Options) so
    the in-app iframe and a plain new-tab open both work in the web
    deployment without round-tripping a publish to the external host."""
    base = _project_artifacts_base(project_name)
    if base is None:
        raise HTTPException(status_code=404, detail="Unknown project")
    try:
        target = (base / file_path).resolve()
        target.relative_to(base.resolve())
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Invalid artifact path") from exc
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Artifact file not found")
    media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    # Deliberately do NOT set X-Frame-Options — the in-app preview
    # frames this same-origin. The viewer's iframe sandbox already
    # drops `allow-same-origin`, so framing can't be abused to read the
    # API with the user's session.
    return FileResponse(target, media_type=media_type, headers={
        "Cache-Control": "private, max-age=60",
    })


# ─── Listing ───────────────────────────────────────────────────────────────


@router.get("")
async def list_artifacts(project_path: str | None = Query(default=None)):
    """Every artifact across all projects, newest first.

    Card payload mirrors the shape the legacy listing returned, plus
    a few new fields the renderer can consume (slug, type,
    description, fileCount, folder). Older renderers that only know
    about `path` / `kind` / `updated` keep working.

    `project_path` scopes the response to one project's
    `<base>/.anton/artifacts/` tree. The rail card uses this so each
    project-detail mount doesn't pay for reading every other
    project's metadata.json.
    """
    cards: list[dict] = []
    for folder in _iter_artifact_folders(project_path):
        meta = _load_metadata(folder)
        if meta is None:
            continue
        files = _user_files(folder)
        primary = _pick_primary(folder, files, primary_hint=meta.get("primary"))
        primary_path = str(primary) if primary is not None else str(folder)
        primary_ext = primary.suffix.lower() if primary is not None else ""
        artifact_type = meta.get("type") or "mixed"
        kind = KIND_BY_TYPE.get(artifact_type) or KIND_BY_EXT.get(primary_ext, "File")
        is_live = False
        if primary is not None:
            try:
                is_live = (time.time() - primary.stat().st_mtime) < 300
            except OSError:
                is_live = False
        idx = len(cards) % len(BG_CYCLE)

        # Sort key — prefer the folder's own updatedAt (deterministic,
        # what the metadata advertises), falling back to the primary
        # file's mtime so very-old artifacts still order sensibly.
        sort_ts: float
        try:
            sort_ts = (folder / "metadata.json").stat().st_mtime
        except OSError:
            sort_ts = 0.0

        cards.append({
            "id": meta.get("id") or folder.name,
            "slug": meta.get("slug") or folder.name,
            "title": meta.get("name") or folder.name,
            "description": meta.get("description") or "",
            "type": artifact_type,
            "kind": kind,
            "ext": primary_ext,
            "updated": _human_mtime(folder / "metadata.json"),
            "live": is_live,
            "bg": BG_CYCLE[idx],
            "fileCount": len(files),
            "folder": str(folder),
            "path": primary_path,
            # Surfaces whether the agent declared a primary or the
            # server fell back to the heuristic — the renderer can
            # show a small "auto" hint in either direction if useful.
            "primary": meta.get("primary") or None,
            "publishedUrl": _published_url_for(folder, primary),
            # Owner-side access state (lock badge + eye-reveal). accessPassword
            # is the plaintext, returned only to the owner's own session.
            **_published_access_for(folder, primary),
            # Origin-relative URL the web client can open / iframe
            # directly. "" when the artifact has no primary file yet.
            "serveUrl": _serve_url_for(primary_path),
            "_sortTs": sort_ts,
        })

    cards.sort(key=lambda c: c["_sortTs"], reverse=True)
    for c in cards:
        c.pop("_sortTs", None)
    # Cap at 80 — same order-of-magnitude as the previous 40 cap on
    # flat files but a touch higher since each artifact is denser.
    return cards[:80]


# ─── Path resolution ───────────────────────────────────────────────────────


def _candidate_relative_artifacts(raw_path: str) -> list[Path]:
    """Resolve a relative path against every project's .anton/artifacts/ dir.

    Accepts any of:
      - `<slug>/dashboard.html`        → matches `<base>/.anton/artifacts/<slug>/dashboard.html`
      - `.anton/artifacts/<slug>/dashboard.html` (legacy callers may include the prefix)
    """
    text = (raw_path or "").strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    parts = [p for p in text.split("/") if p]
    if not text or any(p in (".", "..") for p in parts):
        raise HTTPException(status_code=400, detail="Invalid artifact path")
    if text.startswith("artifacts/"):
        text = text[len("artifacts/"):]
    matches: dict[str, Path] = {}
    for art_root in _scan_artifact_dirs():
        try:
            target = (art_root / text).resolve()
            target.relative_to(art_root.resolve())
        except ValueError:
            continue
        if target.is_file():
            matches[str(target)] = target
    return list(matches.values())


def _resolve_artifact_path(raw_path: str) -> Path:
    """Turn an artifact request path into an absolute path on disk.

    Accepts:
      - Absolute paths under any registered project's `.anton/artifacts/` dir.
      - Relative paths anchored at any artifact root (slug-prefixed or
        with a leading `.anton/artifacts/`).
    Path-traversal guarded; non-existent files yield 404.
    """
    # Reject null bytes, which are used in path injection attacks.
    if "\x00" in raw_path:
        raise HTTPException(status_code=400, detail="Invalid artifact path")
    try:
        # The resolved path is validated against known artifact roots below
        # (relative_to check) — user input cannot escape those directories.
        # codeql[py/path-injection]
        target = Path(raw_path).expanduser()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid artifact path") from exc
    if not str(target).strip():
        raise HTTPException(status_code=400, detail="Invalid artifact path")

    if target.is_absolute():
        resolved = target.resolve()
        for art_root in _scan_artifact_dirs():
            try:
                resolved.relative_to(art_root.resolve())
            except ValueError:
                continue
            if resolved.is_file():
                return resolved
        raise HTTPException(status_code=404, detail="Artifact is not in a known artifacts directory")

    matches = _candidate_relative_artifacts(raw_path)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise HTTPException(
            status_code=400,
            detail="Artifact path matches multiple project artifact roots; pass an absolute path",
        )
    raise HTTPException(status_code=404, detail="Artifact is not in a known artifacts directory")


def _reveal_in_file_manager(artifact: Path) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", "-R", str(artifact)], check=False)
    elif sys.platform == "win32":
        subprocess.run(["explorer", f"/select,{artifact}"], check=False)
    else:
        subprocess.run(["xdg-open", str(artifact.parent)], check=False)


# ─── Preview / open / reveal ───────────────────────────────────────────────


@router.get("/preview")
async def preview_artifact(path: str = Query(...)):
    artifact = _resolve_artifact_path(path)
    suffix = artifact.suffix.lower()
    if suffix not in TEXT_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail="Preview is available for text, Markdown, code, JSON, CSV, and HTML files",
        )
    try:
        text = artifact.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not read artifact") from exc

    return {
        "path": str(artifact),
        "title": artifact.name,
        "kind": KIND_BY_EXT.get(suffix, "File"),
        "mime": mimetypes.guess_type(str(artifact))[0] or "text/plain",
        "content": text[:200_000],
        "truncated": len(text) > 200_000,
    }


# ─── Iframe preview mount ────────────────────────────────────────────────
#
# Two-step flow used by ArtifactViewer to render HTML with relative
# asset references intact:
#
#   1. POST /v1/artifacts/preview-mount {path} → register the artifact's
#      parent dir under a deterministic token, return the entry
#      filename and a relative URL the iframe should load.
#   2. GET  /v1/artifacts/preview-asset/{token}/{rel_path} → serve files
#      from that mounted dir, restricted to descendants of the parent so
#      a malicious artifact can't traverse into the rest of the disk.

class PreviewMountRequest(BaseModel):
    path: str


@router.post("/preview-mount")
async def preview_mount(req: PreviewMountRequest):
    artifact = _resolve_artifact_path(req.path)
    if artifact.suffix.lower() != ".html":
        raise HTTPException(status_code=415, detail="Preview mount is only available for HTML artifacts")
    parent = artifact.parent.resolve()
    token = hashlib.sha256(str(parent).encode("utf-8")).hexdigest()[:16]
    _PREVIEW_MOUNTS[token] = parent

    published_url = ""
    access_protected = False
    access_password = ""
    published_path = parent / ".published.json"
    if published_path.is_file():
        try:
            pmap = json.loads(published_path.read_text(encoding="utf-8"))
            entry = pmap.get(artifact.name)
            if isinstance(entry, dict):
                published_url = entry.get("url", "") or ""
                if entry.get("requires_password"):
                    access_protected = True
                    access_password = entry.get("access_password", "") or ""
        except Exception:
            published_url = ""

    # For app artifacts: start local backend server (no-op for static)
    _app_port = _start_app_server(parent)

    return {
        "token": token,
        "entry": artifact.name,
        "relUrl": f"/artifacts/preview-asset/{token}/{artifact.name}",
        # Stateless, stable, shareable URL for the same file. Preferred
        # by the client over the token `relUrl` — works identically in
        # desktop + web and survives restarts. `relUrl` is kept for
        # back-compat / as a fallback when serveUrl can't be computed.
        "serveUrl": _serve_url_for(artifact),
        "publishedUrl": published_url,
        "appPort": _app_port,
        "accessProtected": access_protected,
        "accessPassword": access_password,
    }


@router.get("/preview-asset/{token}/{rel_path:path}")
async def preview_asset(token: str, rel_path: str):
    parent = _PREVIEW_MOUNTS.get(token)
    if parent is None:
        raise HTTPException(status_code=404, detail="Preview mount has expired or is unknown")
    try:
        target = (parent / rel_path).resolve()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid asset path") from exc
    try:
        target.relative_to(parent)
    except ValueError:
        raise HTTPException(status_code=403, detail="Asset is outside the artifact directory")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")
    media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type, headers={
        "Cache-Control": "private, max-age=300",
    })


class ArtifactAction(BaseModel):
    path: str


@router.post("/open")
async def open_artifact(req: ArtifactAction):
    artifact = _resolve_artifact_path(req.path)
    try:
        subprocess.run(["open", str(artifact)], check=False)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not open artifact") from exc
    return {"status": "ok", "path": str(artifact)}


@router.post("/reveal")
async def reveal_artifact(req: ArtifactAction):
    artifact = _resolve_artifact_path(req.path)
    try:
        _reveal_in_file_manager(artifact)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not reveal artifact") from exc
    return {"status": "ok", "path": str(artifact)}


# ─── App artifact routes ────────────────────────────────────────────────────
#
# These routes handle fullstack-stateful-app artifacts:
#   POST /artifacts/app/publish  — bundle + deploy to Anton Services
#   POST /artifacts/app/stop     — stop local dev server
#   GET  /artifacts/app/log      — git history for an artifact
#   POST /artifacts/rollback     — restore artifact to a past commit
#   DELETE /artifacts/app        — teardown remote app (Lambda + DynamoDB + S3)

import os as _os
import sys as _sys
import zipfile as _zipfile
import io as _io
import base64 as _base64

from .app_server_manager import stop as _stop_app_server
from .artifact_git import (
    commit as _git_commit,
    rollback as _git_rollback,
    log as _git_log,
    push as _git_push,
)


class AppPublishRequest(BaseModel):
    path: str
    """Absolute path to the artifact folder containing manifest.json"""
    auth_mode: str = "none"
    password: str = ""
    allowed_emails: list[str] = []


class AppStopRequest(BaseModel):
    path: str


class RollbackRequest(BaseModel):
    path: str
    commit_sha: str
    redeploy: bool = False


class AppTeardownRequest(BaseModel):
    path: str


@router.post("/app/publish")
async def publish_app_artifact(req: AppPublishRequest):
    """
    Bundle an app artifact folder and send it to the artifact_app_deploy lambda.
    Reads manifest.json, optionally patches auth fields, ZIPs everything,
    POSTs to the deploy endpoint, writes .published.json on success,
    and makes a git commit.
    """
    import json as _json
    import hashlib as _hashlib
    import uuid as _uuid
    from datetime import datetime, timezone
    from pathlib import Path as _Path
    from .settings import _get_env

    folder = _safe_artifact_dir(req.path)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="Artifact folder not found")

    manifest_path = folder / "manifest.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=400, detail="manifest.json not found in artifact folder")

    manifest = _json.loads(manifest_path.read_text())

    # Patch auth fields from request
    if req.auth_mode != "none":
        manifest.setdefault("auth", {})["mode"] = req.auth_mode
    if req.password:
        import bcrypt
        pw_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
        manifest.setdefault("auth", {})["password_hash"] = "bcrypt:" + pw_hash
        manifest_path.write_text(_json.dumps(manifest, indent=2))
    if req.allowed_emails:
        manifest.setdefault("auth", {})["allowed_emails"] = req.allowed_emails
        manifest_path.write_text(_json.dumps(manifest, indent=2))

    # Build ZIP bundle
    buf = _io.BytesIO()
    with _zipfile.ZipFile(buf, "w", _zipfile.ZIP_DEFLATED) as z:
        for p in folder.rglob("*"):
            if p.is_file() and not any(
                part.startswith(".") for part in p.relative_to(folder).parts
            ):
                z.write(p, str(p.relative_to(folder)))
    zip_bytes = buf.getvalue()
    payload_b64 = _base64.b64encode(zip_bytes).decode()

    # Call deploy lambda via Anton Services API
    deploy_url = _get_env("ANTON_DEPLOY_URL", "https://4nton.ai/app-deploy")
    api_key    = _get_env("ANTON_MINDS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="ANTON_MINDS_API_KEY not configured")

    import urllib.request, urllib.error
    body = _json.dumps({"file_payload": payload_b64}).encode()
    req_obj = urllib.request.Request(
        deploy_url,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "antontron/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req_obj, timeout=180) as resp:
            result = _json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode() if e.fp else str(e)
        raise HTTPException(status_code=502, detail=f"Deploy failed: {detail}")
    except urllib.error.URLError as e:
        raise HTTPException(status_code=502, detail=f"Deploy unreachable: {e.reason}")

    # Persist published state
    published_path = folder / ".published.json"
    pmap: dict = {}
    if published_path.is_file():
        try:
            pmap = _json.loads(published_path.read_text())
        except Exception:
            pmap = {}
    pmap["manifest.json"] = {
        "app_id":       result.get("app_id"),
        "frontend_url": result.get("frontend_url"),
        "api_url":      result.get("api_url"),
        "url":          result.get("frontend_url"),
        "md5":          result.get("md5"),
        "deployed_at":  result.get("deployed_at"),
    }
    published_path.write_text(_json.dumps(pmap, indent=2))

    # Git commit
    slug = folder.name
    title = manifest.get("title", slug)
    _git_commit(folder, slug, "publish", f"deployed to 4nton.ai — {title}")

    # GitHub push (best-effort)
    _git_push(folder.parents[3])

    return {
        "status": "ok",
        "app_id":       result.get("app_id"),
        "frontend_url": result.get("frontend_url"),
        "api_url":      result.get("api_url"),
        "deployed_at":  result.get("deployed_at"),
    }


@router.post("/app/stop")
async def stop_app_server(req: AppStopRequest):
    """Stop the local dev server for an app artifact."""
    folder = _safe_artifact_dir(req.path)
    _stop_app_server(folder)
    return {"status": "stopped"}


@router.get("/app/log")
async def get_artifact_log(path: str = Query(..., description="Absolute path to artifact folder")):
    """Return git commit history for an artifact folder."""
    folder = _safe_artifact_dir(path)
    entries = _git_log(folder)
    return {"entries": entries}


@router.post("/rollback")
async def rollback_artifact(req: RollbackRequest):
    """
    Restore an artifact folder to a specific git commit SHA.
    If redeploy=true, triggers a re-publish after rollback.
    """
    folder = _safe_artifact_dir(req.path)
    slug   = folder.name

    ok = _git_rollback(folder, slug, req.commit_sha)
    if not ok:
        raise HTTPException(status_code=500, detail="Rollback failed — check git history")

    _git_commit(folder, slug, "rollback", f"restored to {req.commit_sha[:8]}")

    result: dict = {"status": "rolled_back", "sha": req.commit_sha[:8]}

    if req.redeploy:
        from .settings import _get_env
        deploy_url = _get_env("ANTON_DEPLOY_URL", "https://4nton.ai/app-deploy")
        if deploy_url:
            # Re-use the publish endpoint internally
            pub_req = AppPublishRequest(path=req.path)
            pub_result = await publish_app_artifact(pub_req)
            result["redeployed"] = pub_result

    return result


@router.delete("/app")
async def teardown_app_artifact(path: str = Query(..., description="Absolute path to artifact folder")):
    """
    Tear down the remote app: remove Lambda, DynamoDB table, S3 files, API GW route.
    Writes a tombstone to .published.json. Local files are NOT deleted.
    """
    import json as _json
    from pathlib import Path as _Path
    from .settings import _get_env

    folder = _safe_artifact_dir(path)
    published_path = folder / ".published.json"

    if not published_path.is_file():
        raise HTTPException(status_code=404, detail="No published state found for this artifact")

    pmap   = _json.loads(published_path.read_text())
    app_id = pmap.get("manifest.json", {}).get("app_id")
    if not app_id:
        raise HTTPException(status_code=400, detail="app_id not found in published state")

    teardown_url = _get_env("ANTON_DEPLOY_URL", "https://4nton.ai/app-deploy")
    api_key      = _get_env("ANTON_MINDS_API_KEY", "")

    import urllib.request, urllib.error
    req_obj = urllib.request.Request(
        f"{teardown_url}?app_id={app_id}",
        headers={"Authorization": f"Bearer {api_key}", "User-Agent": "antontron/1.0"},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req_obj, timeout=60) as resp:
            pass
    except urllib.error.HTTPError as e:
        if e.code != 404:   # 404 = already gone, that's fine
            detail = e.read().decode() if e.fp else str(e)
            raise HTTPException(status_code=502, detail=f"Teardown failed: {detail}")

    # Write tombstone
    pmap["manifest.json"]["torn_down_at"] = __import__("datetime").datetime.utcnow().isoformat()
    pmap["manifest.json"]["url"] = ""
    published_path.write_text(_json.dumps(pmap, indent=2))

    slug = folder.name
    _git_commit(folder, slug, "teardown", f"removed from 4nton.ai  app_id={app_id}")

    return {"status": "torn_down", "app_id": app_id}
