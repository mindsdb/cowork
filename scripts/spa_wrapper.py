"""Docker entrypoint — wraps cowork-server with SPA static-file serving.

In the Docker image, the same FastAPI process serves both:
  /api/v1/*  — cowork-server API endpoints
  /          — cowork SPA (single-page app with client-side routing)

This wrapper imports the cowork-server app and adds SPA routes on top.
Run with: uvicorn spa_wrapper:app --host 0.0.0.0 --port 26866
"""

import os
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from cowork.server import app  # noqa: F401 — re-exported for uvicorn

SPA_DIR = Path(os.environ.get("COWORK_SPA_DIR", "/app/dist/renderer-web"))

if SPA_DIR.exists():
    for _sub in ("assets", "fonts", "gravity-field", "logos"):
        _sub_path = SPA_DIR / _sub
        if _sub_path.exists():
            app.mount(
                f"/{_sub}",
                StaticFiles(directory=str(_sub_path)),
                name=f"spa-{_sub}",
            )

    # Look up filenames in an allowlist; never combine an untrusted request path with SPA_DIR.
    _spa_files: dict[str, Path] = {
        entry.name: entry for entry in SPA_DIR.iterdir() if entry.is_file()
    }
    _spa_shell: Path = SPA_DIR / "index-web.html"

    @app.get("/health")
    async def health_compat():
        # mindshub_frontend probes /health; update that caller before removing this compatibility route.
        from cowork.api.v1.endpoints.health import health

        return health()

    @app.get("/")
    async def root():
        return FileResponse(str(_spa_shell))

    @app.api_route(
        "/{full_path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )
    async def spa_fallback(full_path: str, request: Request):
        # The catch-all wins before Starlette's slash redirect. Preserve API methods with 307
        # and return 404 for missing API routes instead of serving the SPA.
        if full_path.startswith("api/") or full_path == "api":
            if not full_path.endswith("/"):
                qs = str(request.url.query)
                target = f"/{full_path}/" + (f"?{qs}" if qs else "")
                return RedirectResponse(url=target, status_code=307)
            raise HTTPException(status_code=404)
        served = _spa_files.get(full_path)
        if served is not None:
            return FileResponse(str(served))
        return FileResponse(str(_spa_shell))
