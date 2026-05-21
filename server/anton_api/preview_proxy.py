"""In-process HTTP proxy for backend+frontend artifact previews.

Web counterpart of `src/main/preview-proxy.ts`. The Electron shell hosts
its own loopback forwarder in the main process; the web shell can't —
the renderer is sandboxed and has no `window.antontron` bridge. This
module brings up a Starlette-on-uvicorn listener inside the cowork
Python process so the iframe has a stable loopback URL to load.

Shape mirrors the TypeScript version intentionally:
  - One listener for the whole cowork session; the served artifact dir
    is swapped on each `preview-mount`.
  - The backend port is re-read from `metadata.json` on every request,
    so a relaunch that picks a new port is picked up automatically.
  - CORS headers are injected on every response — artifact backends
    aren't required to know about CORS, and the sandboxed iframe has
    an opaque origin, so without these headers every fetch from
    artifact JS is blocked browser-side.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from pathlib import Path
from typing import Optional

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response, StreamingResponse
from starlette.routing import Route

logger = logging.getLogger(__name__)

# Hop-by-hop headers (RFC 7230 §6.1) — never forwarded either direction.
_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

# Any CORS headers from the upstream backend are dropped so we can
# inject our own consistent set — duplicates would be treated as a
# CORS error by the browser.
_CORS_RESPONSE_HEADERS = {
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-allow-credentials",
    "access-control-expose-headers",
    "access-control-max-age",
}

# Headers the upstream `httpx` request must not carry — `Content-Length`
# is recomputed by httpx itself, and `Host` is rewritten below.
_UPSTREAM_BLOCKED_REQUEST_HEADERS = {"content-length", "host"}

_state: dict = {
    "artifact_dir": None,  # Optional[Path]
    "port": None,           # Optional[int]
    "server": None,         # Optional[uvicorn.Server]
    "server_task": None,    # Optional[asyncio.Task]
    "client": None,         # Optional[httpx.AsyncClient]
    "lock": asyncio.Lock(),
}


def _read_backend_port(artifact_dir: Path) -> Optional[int]:
    try:
        meta = json.loads((artifact_dir / "metadata.json").read_text(encoding="utf-8"))
    except Exception:
        return None
    port = meta.get("port")
    if isinstance(port, int) and 0 < port < 65536:
        return port
    return None


def _cors_headers(req: Request) -> dict[str, str]:
    requested = req.headers.get("access-control-request-headers") or "*"
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": requested,
        "Access-Control-Max-Age": "600",
    }


def _strip_hop_headers(headers, *, drop_cors: bool) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for k, v in headers.items():
        lk = k.lower()
        if lk in _HOP_HEADERS:
            continue
        if drop_cors and lk in _CORS_RESPONSE_HEADERS:
            continue
        out.append((k, v))
    return out


def _build_upstream_headers(req: Request, backend_port: int) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for k, v in req.headers.items():
        lk = k.lower()
        if lk in _HOP_HEADERS or lk in _UPSTREAM_BLOCKED_REQUEST_HEADERS:
            continue
        out.append((k, v))
    out.append(("host", f"127.0.0.1:{backend_port}"))
    return out


async def _handle(request: Request) -> Response:
    cors = _cors_headers(request)

    # Short-circuit preflight so artifact backends don't need to
    # implement OPTIONS themselves.
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=cors)

    artifact_dir: Optional[Path] = _state["artifact_dir"]
    if artifact_dir is None:
        return PlainTextResponse(
            "No active artifact preview", status_code=503, headers=cors
        )
    backend_port = _read_backend_port(artifact_dir)
    if backend_port is None:
        return PlainTextResponse(
            "Artifact backend is not running yet", status_code=503, headers=cors
        )

    client: Optional[httpx.AsyncClient] = _state["client"]
    if client is None:
        return PlainTextResponse("Proxy not initialised", status_code=503, headers=cors)

    body = await request.body()
    url = f"http://127.0.0.1:{backend_port}{request.url.path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    upstream_headers = _build_upstream_headers(request, backend_port)

    upstream_req = client.build_request(
        request.method,
        url,
        headers=upstream_headers,
        content=body,
    )
    try:
        upstream = await client.send(upstream_req, stream=True)
    except httpx.RequestError as exc:
        # ECONNREFUSED while the backend is starting / dead — surface as
        # 502 so the iframe shows the upstream error rather than us.
        return PlainTextResponse(
            f"Proxy error: {exc}", status_code=502, headers=cors
        )

    resp_headers = _strip_hop_headers(upstream.headers, drop_cors=True)
    resp_headers.extend(cors.items())

    async def body_iter():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=dict(resp_headers),
    )


_app = Starlette(
    routes=[
        Route(
            "/{path:path}",
            _handle,
            methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        ),
    ]
)


async def start() -> int:
    """Boot the listener on a free loopback port. Idempotent."""
    async with _state["lock"]:
        if _state["server"] is not None and _state["port"] is not None:
            return _state["port"]

        config = uvicorn.Config(
            _app,
            host="127.0.0.1",
            port=0,
            log_level="warning",
            lifespan="off",
            access_log=False,
        )
        server = uvicorn.Server(config)
        client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

        task = asyncio.create_task(server.serve(), name="preview-proxy")

        # uvicorn populates `server.servers` after `serve()` finishes its
        # bind phase. Poll briefly so we can read back the chosen port.
        for _ in range(200):  # ~2s ceiling
            if server.started and server.servers and server.servers[0].sockets:
                break
            await asyncio.sleep(0.01)
        if not server.servers or not server.servers[0].sockets:
            server.should_exit = True
            await asyncio.gather(task, return_exceptions=True)
            await client.aclose()
            raise RuntimeError("preview_proxy: uvicorn failed to bind")

        port = server.servers[0].sockets[0].getsockname()[1]
        _state["server"] = server
        _state["server_task"] = task
        _state["client"] = client
        _state["port"] = port
        logger.info("preview_proxy listening on 127.0.0.1:%d", port)
        return port


def set_artifact(artifact_dir: Path | str) -> None:
    """Point the proxy at a new artifact dir. Subsequent requests read
    `metadata.json` from this dir to find the backend port."""
    _state["artifact_dir"] = Path(artifact_dir)


def clear_artifact() -> None:
    _state["artifact_dir"] = None


def get_port() -> Optional[int]:
    return _state["port"]


def url_for(artifact_dir: Path | str) -> Optional[str]:
    """Build the iframe URL for `artifact_dir`. None if the proxy hasn't
    started yet (which shouldn't happen post-lifespan-startup)."""
    port = _state["port"]
    if port is None:
        return None
    tag = (
        base64.urlsafe_b64encode(str(artifact_dir).encode("utf-8"))
        .decode("ascii")
        .rstrip("=")[:12]
    )
    return f"http://127.0.0.1:{port}/?v={tag}"


async def shutdown() -> None:
    server: Optional[uvicorn.Server] = _state["server"]
    task: Optional[asyncio.Task] = _state["server_task"]
    client: Optional[httpx.AsyncClient] = _state["client"]
    if server is not None:
        server.should_exit = True
    if task is not None:
        try:
            await asyncio.wait_for(task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            task.cancel()
    if client is not None:
        try:
            await client.aclose()
        except Exception:
            pass
    _state.update(
        artifact_dir=None,
        port=None,
        server=None,
        server_task=None,
        client=None,
    )
