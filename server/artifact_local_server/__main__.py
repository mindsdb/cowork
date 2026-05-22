"""
artifact_local_server — run an app artifact's handler.py locally.

Usage (spawned automatically by antontron):
    python -m artifact_local_server <artifact_folder_path>

Environment:
    PORT          TCP port to listen on (default 57000)
    APP_ID        Artifact app_id (from manifest)
    AUTH_MODE     Always "none" locally — auth is bypassed
    LOCAL_MODE    Always "1"
    STORAGE_PATH  Path to the SQLite DB file
"""

import importlib.util
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path

logger = logging.getLogger("artifact_local_server")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [local-server] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)


def _load_handler(folder: Path):
    """Import handler.py from the artifact folder as a fresh module."""
    handler_path = folder / "handler.py"
    if not handler_path.exists():
        raise FileNotFoundError(f"handler.py not found in {folder}")
    spec = importlib.util.spec_from_file_location("artifact_handler", str(handler_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _event_from_request(method: str, path: str, headers: dict,
                         query: dict, body: bytes) -> dict:
    """Build a minimal Lambda event dict from an HTTP request."""
    return {
        "httpMethod": method.upper(),
        "path": "/" + path.lstrip("/"),
        "headers": {k.lower(): v for k, v in headers.items()},
        "queryStringParameters": dict(query) or None,
        "body": body.decode("utf-8", errors="replace") if body else None,
        "isBase64Encoded": False,
    }


def run(folder: Path, port: int) -> None:
    """Start the local dev server. Blocks until killed."""
    try:
        from fastapi import FastAPI, Request
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import JSONResponse, Response
        import uvicorn
    except ImportError:
        logger.error(
            "fastapi and uvicorn are required for local artifact dev server. "
            "Run: pip install fastapi uvicorn"
        )
        sys.exit(1)

    app = FastAPI(title=f"Anton local — {folder.name}")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Handler state — reloaded on file change
    state = {"mod": None, "mtime": 0.0, "error": None}

    def _reload_if_changed():
        handler_path = folder / "handler.py"
        try:
            mtime = handler_path.stat().st_mtime
        except FileNotFoundError:
            return
        if mtime != state["mtime"]:
            try:
                state["mod"] = _load_handler(folder)
                state["mtime"] = mtime
                state["error"] = None
                logger.info("handler.py reloaded ✓")
            except Exception as e:
                state["error"] = str(e)
                logger.error("handler.py reload failed: %s", e)

    # Initial load
    _reload_if_changed()

    # Background file watcher thread
    def _watch():
        while True:
            time.sleep(0.5)
            _reload_if_changed()

    watcher = threading.Thread(target=_watch, daemon=True)
    watcher.start()

    @app.api_route("/{path:path}", methods=["GET","POST","PUT","DELETE","PATCH","HEAD","OPTIONS"])
    async def proxy(path: str, request: Request) -> Response:
        _reload_if_changed()

        if state["error"]:
            return JSONResponse(
                {"error": "handler.py has a syntax error", "detail": state["error"]},
                status_code=500,
            )
        if state["mod"] is None:
            return JSONResponse({"error": "handler.py not loaded"}, status_code=503)

        body = await request.body()
        event = _event_from_request(
            method=request.method,
            path=path,
            headers=dict(request.headers),
            query=dict(request.query_params),
            body=body,
        )

        try:
            result = state["mod"].lambda_handler(event, _make_context())
        except Exception as e:
            # Full traceback goes to the operator's terminal (this is a
            # local dev server — they're staring at the log). The HTTP
            # response keeps only the exception class name so a handler
            # that accidentally embeds secrets in its message can't leak
            # them through the response body.
            logger.exception("handler.lambda_handler raised")
            return JSONResponse(
                {"error": "handler raised an exception", "type": type(e).__name__},
                status_code=500,
            )

        status  = result.get("statusCode", 200)
        headers = result.get("headers", {})
        raw     = result.get("body", "")

        # Try to return JSON if body is a JSON string
        if isinstance(raw, str) and raw.strip().startswith(("{", "[")):
            try:
                data = json.loads(raw)
                resp = JSONResponse(data, status_code=status)
                for k, v in headers.items():
                    resp.headers[k] = v
                return resp
            except json.JSONDecodeError:
                pass

        return Response(
            content=raw.encode() if isinstance(raw, str) else raw,
            status_code=status,
            headers=headers,
            media_type=headers.get("Content-Type", "text/plain"),
        )

    logger.info("Starting local artifact server on http://127.0.0.1:%d", port)
    logger.info("Artifact folder: %s", folder)
    logger.info("Hot-reload: enabled (watching handler.py)")
    logger.info("Auth: bypassed (LOCAL_MODE=1)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def _make_context():
    class _Ctx:
        function_name = "artifact-local"
        memory_limit_in_mb = 256
        aws_request_id = "local-" + os.urandom(4).hex()
        remaining_time_in_millis = lambda self: 30000
    return _Ctx()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m artifact_local_server <artifact_folder>", file=sys.stderr)
        sys.exit(1)

    folder = Path(sys.argv[1]).resolve()
    if not folder.is_dir():
        print(f"Not a directory: {folder}", file=sys.stderr)
        sys.exit(1)

    # Read manifest for app metadata
    manifest_path = folder / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        app_id = manifest.get("app_id", folder.name)
        storage = manifest.get("storage", {})
    else:
        app_id = folder.name
        storage = {}

    port = int(os.environ.get("PORT", "57000"))

    # Inject env vars that handler.py expects
    os.environ.setdefault("LOCAL_MODE",   "1")
    os.environ.setdefault("AUTH_MODE",    "none")
    os.environ.setdefault("APP_ID",       app_id)
    os.environ.setdefault("STORAGE_PATH", str(folder / ".local" / "db.sqlite3"))

    if storage.get("dynamodb"):
        schema = storage.get("table_schema", {})
        # Set pk/sk env vars for SqliteStore auto-config
        os.environ.setdefault("STORE_PK", schema.get("pk", "pk"))
        os.environ.setdefault("STORE_SK", schema.get("sk", "sk"))

    run(folder, port)
