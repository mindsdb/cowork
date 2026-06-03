"""
app_server_manager — spawn and track per-artifact local backend servers.

Each fullstack-stateful-app artifact gets a subprocess running
`python -m artifact_local_server <folder>` on an auto-assigned port.

The manager is a module-level singleton. antontron imports it and:
  - calls `start(folder)` when ArtifactViewer opens an app artifact
  - calls `stop(folder)` when the viewer is closed
  - calls `get_port(folder)` to inject window.__API_URL__ into the preview

Port range: 57000–57099 (100 concurrent local apps, plenty for one user).
"""

from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

_PORT_START = 57000
_PORT_END   = 57099

_lock      = Lock()
# folder_str → {"process": Popen, "port": int}
_running: dict[str, dict] = {}


def _free_port() -> int:
    """Return a free port in the reserved range."""
    used = {info["port"] for info in _running.values()}
    for p in range(_PORT_START, _PORT_END + 1):
        if p in used:
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    raise RuntimeError("No free ports available in range 57000–57099")


def _is_app_artifact(folder: Path) -> bool:
    manifest = folder / "manifest.json"
    if not manifest.is_file():
        return False
    try:
        m = json.loads(manifest.read_text())
        return m.get("backend", {}).get("enabled", False)
    except Exception:
        return False


def start(folder: Path) -> int | None:
    """
    Ensure the local backend server is running for this artifact.
    Returns the port number, or None if not an app artifact.
    """
    if not _is_app_artifact(folder):
        return None

    key = str(folder.resolve())
    with _lock:
        existing = _running.get(key)
        if existing:
            proc = existing["process"]
            if proc.poll() is None:          # still alive
                return existing["port"]
            else:
                logger.warning("Local server for %s died, restarting", folder.name)
                _running.pop(key)

        port = _free_port()
        manifest = json.loads((folder / "manifest.json").read_text())
        storage  = manifest.get("storage", {})
        schema   = storage.get("table_schema", {})

        env = {
            **os.environ,
            "PORT":         str(port),
            "LOCAL_MODE":   "1",
            "AUTH_MODE":    "none",
            "APP_ID":       manifest.get("app_id", folder.name),
            "STORAGE_PATH": str(folder / ".local" / "db.sqlite3"),
            "STORE_PK":     schema.get("pk", "pk"),
            "STORE_SK":     schema.get("sk", "sk"),
        }
        # Merge any backend env overrides from manifest
        for k, v in manifest.get("backend", {}).get("env", {}).items():
            env[k] = str(v)

        # The artifact_local_server package lives next to this file
        server_pkg = str(Path(__file__).parent.parent / "artifact_local_server")
        proc = subprocess.Popen(
            [sys.executable, server_pkg, str(folder)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        _running[key] = {"process": proc, "port": port}
        logger.info("Started local server for %s on port %d (pid %d)",
                    folder.name, port, proc.pid)

        # Brief wait to let uvicorn bind
        _wait_ready(port, timeout=5.0)
        return port


def stop(folder: Path) -> None:
    """Terminate the local backend server for this artifact, if running."""
    key = str(folder.resolve())
    with _lock:
        info = _running.pop(key, None)
    if info:
        proc = info["process"]
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        logger.info("Stopped local server for %s (port %d)", folder.name, info["port"])


def get_port(folder: Path) -> int | None:
    """Return the current port for a running local server, or None."""
    key = str(folder.resolve())
    info = _running.get(key)
    if info and info["process"].poll() is None:
        return info["port"]
    return None


def stop_all() -> None:
    """Stop all running local servers. Called at antontron shutdown."""
    keys = list(_running.keys())
    for key in keys:
        stop(Path(key))


def _wait_ready(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.1)
    # Non-fatal — server may just be slow to bind
    logger.warning("Local server on port %d not ready after %.1fs", port, timeout)
