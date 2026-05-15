"""
Artifacts — outputs Anton produces, surfaced to the user.

Each artifact is a folder under `<project>/.anton/artifacts/<slug>/` —
the same path Anton's `settings.artifacts_dir` resolves to at runtime
(`base / ".anton" / "artifacts"`, see anton/workspace.py). The folder
owns its `metadata.json` (Pydantic-validated source of truth) and
`README.md` (rendered from metadata). Multi-file outputs (HTML + CSS +
JS, app + dataset) cluster together; single-file outputs (document,
image) live in their own folder anyway so provenance can attach.

This module:
  - Lists every artifact across registered projects, newest first.
  - Resolves a request path (relative slug-anchored or absolute) to
    a real file on disk for opening / previewing.
  - Mounts an HTML artifact's parent dir as a token-keyed asset URL
    so the in-app iframe preview can resolve relative `<script>` /
    `<link>` references the same way a browser would.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import mimetypes
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterator

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from anton_api import projects_store

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

    Matches Anton's runtime `settings.artifacts_dir`, which resolves to
    `<base>/.anton/artifacts/` (see anton/workspace.py:38 — joined as
    `_anton_dir / settings.artifacts_dir`). This must stay in sync with
    where `create_artifact` actually writes; older builds wrote to
    `<base>/artifacts/` — those are no longer scanned.

    Project paths are funnelled through `_registered_project_dirs`
    so a tampered projects-store entry (symlink pointing outside
    the projects root, hand-edited path) can't leak an artifact
    root that escapes the allowlisted projects directory.

    The legacy `.anton/output/` flat dump is intentionally NOT
    scanned anymore — the new model demands per-folder metadata
    and old files have neither.
    """
    dirs: dict[str, Path] = {}
    for project_dir in _registered_project_dirs():
        candidate = project_dir / ".anton" / "artifacts"
        if candidate.is_dir():
            dirs[str(candidate.resolve())] = candidate
    return list(dirs.values())


def _iter_artifact_folders(project_path: str | None = None) -> Iterator[Path]:
    """Yield every direct subfolder of every project's artifacts/ dir.

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
    """Resolve a relative path against every project's `.anton/artifacts/` dir.

    Accepts any of:
      - `<slug>/dashboard.html`                      → matches `<base>/.anton/artifacts/<slug>/dashboard.html`
      - `artifacts/<slug>/dashboard.html`            (legacy prefix, still tolerated)
      - `.anton/artifacts/<slug>/dashboard.html`     (full-prefix form)
    """
    text = (raw_path or "").strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    parts = [p for p in text.split("/") if p]
    if not text or any(p in (".", "..") for p in parts):
        raise HTTPException(status_code=400, detail="Invalid artifact path")
    if text.startswith(".anton/artifacts/"):
        text = text[len(".anton/artifacts/"):]
    elif text.startswith("artifacts/"):
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
      - Relative paths anchored at any artifact root (slug-prefixed, or
        with a leading `artifacts/` / `.anton/artifacts/`).
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


# ─── Backend-artifact auto-launch ────────────────────────────────────────
#
# When the user opens preview for a `fullstack-stateful-app` artifact,
# its `metadata.json` tells us which TCP port the backend originally
# bound to. That backend may or may not still be alive — the chat
# session that launched it could be gone, cowork might have been
# restarted, the process might have crashed. Rather than refuse to
# preview, we probe the port and try to bring the backend back up if
# it's down: delegate to anton's `launch_artifact_backend` so the
# spawn semantics (slug-keyed venv, requirements.txt install,
# `--port` flag, HTTP+TCP readiness probe) match Anton's own
# `launch_backend` tool exactly. The new port is persisted back to
# metadata.json so the Electron proxy and future opens pick it up.

# Launched-by-cowork backend tracking, keyed by artifact slug. The shape
# matches anton's helper: {"proc": asyncio.subprocess.Process, "port": int,
# "pid": int, "log_path": str}. Lets us avoid double-launching on rapid
# reopens, and reap on shutdown.
_LAUNCHED_BACKENDS: dict[str, dict] = {}

# Per-slug mutex so two parallel `preview-mount` requests (React
# StrictMode double-effects, a double-click) can't both decide the port
# is dead and spawn two backends side by side.
_BACKEND_LAUNCH_LOCKS: dict[str, asyncio.Lock] = {}


def _launch_lock(key: str) -> asyncio.Lock:
    lock = _BACKEND_LAUNCH_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _BACKEND_LAUNCH_LOCKS[key] = lock
    return lock


def _probe_port(port: int, *, timeout: float = 0.3) -> bool:
    """True iff something is accepting TCP connections on 127.0.0.1:<port>."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def _resolve_project_root(artifact_dir: Path) -> Path | None:
    """The registered project root that owns this artifact dir, if any.

    `artifact_dir` is the parent of the primary file (e.g.
    `<project>/.anton/artifacts/<slug>/`). We walk back to the registered
    project root by checking ancestors against `_registered_project_dirs()`.
    Returns None when the dir isn't under any registered project — in
    which case auto-launch is a non-starter anyway.
    """
    try:
        artifact_resolved = artifact_dir.resolve()
    except OSError:
        return None
    registered = _registered_project_dirs()
    for parent in (artifact_resolved, *artifact_resolved.parents):
        if parent in registered:
            return parent
    return None


async def _ensure_backend_running(
    artifact_dir: Path, port: int
) -> tuple[bool, str, int]:
    """Bring up the artifact's backend if it isn't already listening.

    Returns `(running, detail, port)`:
      - `running=True`  → port is alive; `detail` is a short label
        ("already_running" or "launched"); `port` may differ from the
        input when the helper had to allocate a fresh free port.
      - `running=False` → backend is down and we couldn't start it;
        `detail` carries the reason; `port` echoes the input port.
    """
    slug = artifact_dir.name
    if _probe_port(port):
        return True, "already_running", port

    # Serialize launches per-slug. Whichever request wins the lock does
    # the actual work; the rest just re-probe after it releases.
    async with _launch_lock(slug):
        if _probe_port(port):
            return True, "already_running", port
        return await _launch_backend_locked(artifact_dir, slug)


async def _launch_backend_locked(
    artifact_dir: Path, slug: str
) -> tuple[bool, str, int]:
    """Spawn the artifact's backend via anton's shared launcher.

    The slug-keyed scratchpad venv (provisioned by Anton when the agent
    built the artifact) is the python interpreter; `requirements.txt`
    in the artifact folder is installed before spawn; the launcher
    picks a free port and passes `--port <port>` to the script. New
    port is persisted into `metadata.json` so the Electron proxy reads
    a current value on its next request.
    """
    from anton.core.artifacts.backend_launcher import launch_artifact_backend
    from anton.core.artifacts import ArtifactStore
    from anton_api import scratchpad_runtime

    project_root = _resolve_project_root(artifact_dir)
    if project_root is None:
        return False, "Artifact is not in a registered project.", 0

    pool = scratchpad_runtime.WorkspaceScopedPool(str(project_root))
    result = await launch_artifact_backend(
        slug=slug,
        artifact_folder=artifact_dir,
        scratchpad_pool=pool,
        tracked_backends=_LAUNCHED_BACKENDS,
    )
    if isinstance(result, str):
        # Helper returned an error string. Strip the redundant "Error: "
        # prefix so the message reads naturally in the preview pane.
        detail = result[len("Error: "):] if result.startswith("Error: ") else result
        return False, detail, 0

    new_port = int(result["port"])
    try:
        store = ArtifactStore(artifact_dir.parent)
        store.update(slug, port=new_port)
    except Exception as exc:
        # Metadata write failure shouldn't abort an otherwise-working
        # relaunch — the backend is up; the Electron proxy will still
        # work for this session because we return the new port directly.
        logger.warning("Could not persist backend port to metadata: %s", exc)

    logger.info(
        "Auto-launched artifact backend via anton helper: slug=%s port=%d pid=%s",
        slug, new_port, result.get("pid"),
    )
    return True, "launched", new_port


def shutdown_launched_backends() -> None:
    """Terminate every backend cowork itself launched. Called on app shutdown.

    Synchronous: we schedule `proc.terminate()` (which is non-blocking on
    `asyncio.subprocess.Process`) without awaiting `proc.wait()`. The
    cowork server is exiting anyway, and PR_SET_PDEATHSIG on Linux
    already makes the kernel SIGTERM the backends when we go. macOS
    relies on the explicit `terminate()` call.
    """
    for slug, entry in list(_LAUNCHED_BACKENDS.items()):
        proc = entry.get("proc")
        if proc is not None and proc.returncode is None:
            try:
                proc.terminate()
            except (OSError, ProcessLookupError):
                pass
        _LAUNCHED_BACKENDS.pop(slug, None)


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
    parent = artifact.parent.resolve()

    # Backend+frontend artifacts carry a running web server. Detect them
    # by a `port` field in metadata.json — the iframe will load through
    # the Electron-main proxy instead of preview-asset.
    backend_port: int | None = None
    metadata_path = parent / "metadata.json"
    if metadata_path.is_file():
        try:
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
            raw_port = meta.get("port")
            if isinstance(raw_port, int) and 0 < raw_port < 65536:
                backend_port = raw_port
        except Exception:
            backend_port = None

    if backend_port is not None:
        # Proxy mode: renderer talks to the main-process forwarder. We
        # only echo back the directory so main can lazy-read the port
        # on each request (survives backend restarts that pick a new
        # port and rewrite metadata.json).
        #
        # Auto-launch: if nothing is listening on the recorded port, try
        # to bring the backend back up before handing off the proxy URL.
        # `running=False` is non-fatal — the renderer still gets the URL
        # and shows whatever the proxy returns (typically a connection
        # error message), and `launchError` lets it surface a hint to
        # the user. A successful relaunch returns a fresh port (anton's
        # helper allocates one each time); we echo it back so the
        # renderer doesn't have to re-read metadata.json.
        running, launch_detail, current_port = await _ensure_backend_running(
            parent, backend_port
        )
        return {
            "kind": "proxy",
            "artifactDir": str(parent),
            "port": current_port if running else backend_port,
            "backendRunning": running,
            "launchError": "" if running else launch_detail,
        }

    if artifact.suffix.lower() != ".html":
        raise HTTPException(status_code=415, detail="Preview mount is only available for HTML artifacts")
    token = hashlib.sha256(str(parent).encode("utf-8")).hexdigest()[:16]
    _PREVIEW_MOUNTS[token] = parent

    published_url = ""
    published_path = parent / ".published.json"
    if published_path.is_file():
        try:
            pmap = json.loads(published_path.read_text(encoding="utf-8"))
            entry = pmap.get(artifact.name)
            if isinstance(entry, dict):
                published_url = entry.get("url", "") or ""
        except Exception:
            published_url = ""

    return {
        "kind": "static",
        "token": token,
        "entry": artifact.name,
        "relUrl": f"/artifacts/preview-asset/{token}/{artifact.name}",
        "publishedUrl": published_url,
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
